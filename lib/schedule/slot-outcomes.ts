// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Slot outcomes: what happened to each scheduled slot of a Person medication on a Calendar day
 * (Schedule clock). A row exists only once a dose is attached or the slot is Missed, so labels
 * survive later schedule edits. Kept separate from `dose_expectation_outcomes`.
 *
 * Write-only decisions live here as plain data (`DoseTiming`, `missed` lists, `clearsReminder`) so the
 * notification and prompt layers can act on them without this module sending anything. Missed raises
 * no alert and never blocks a dose (ADR-0011).
 */

import type Database from "better-sqlite3-multiple-ciphers"
import { resolveCalendarContext, type CalendarContext } from "@/lib/calendar-context"
import { addCalendarDaysToIsoYmd, formatHHMM, parseHHMM, tzLocalYmdAndOffset, utcMsToLocalYmd } from "@/lib/datetime"
import { isSlotExternal } from "@/lib/schedule/dose-expectation"
import { loadDoseExpectationState } from "@/lib/schedule/dose-expectation-store"
import {
  isScheduleActiveOnYmd,
  parseScheduleFrequencyUnknown,
  parseScheduleTimesJson,
} from "@/lib/schedule/schedule-recurrence"
import { isSlotBeforeScheduleCreation, localYmdAt, resolveSlotMs } from "@/lib/schedule/schedule-slot-evaluator"
import { runInChunks } from "@/lib/sql-chunks"

export { localYmdAt }

/** A dose within this long either side of a slot is On time. Fixed, not a setting. */
export const ON_TIME_WINDOW_MS = 10 * 60_000

export type SlotResult = "on_time" | "early" | "late" | "missed" | "given"
export type MissedCause = "timed_out" | "not_given" | "early_answer"

export interface SlotOutcome {
  personMedicationId: number
  ymd: string
  slotHhmm: string
  result: SlotResult
  /** Minutes from slot to dose (negative = early); null for missed and given. */
  offsetMinutes: number | null
  missedCause: MissedCause | null
  recordId: number | null
}

/** Resolves the Calendar context for a schedule timezone at an instant; null when none can be worked out. */
export type CalendarFor = (scheduleTz: string | null, atMs: number) => CalendarContext | null

export type DoseTiming =
  | { kind: "unscheduled" }
  /** Attached silently to its slot. */
  | { kind: "on_time"; personMedicationId: number; ymd: string; slotHhmm: string; offsetMinutes: number }
  /** Inside the window of a slot that already has a dose, or with no slot to offer: stored as an extra dose, no prompt. */
  | { kind: "extra" }
  /** Outside every window: nothing is stored until answered; unanswered it stays an extra dose. */
  | {
      kind: "needs_prompt"
      personMedicationId: number
      ymd: string
      /** Latest earlier slot (same Calendar day) with no dose, for "Late". */
      previousSlot: string | null
      /** First later slot (same Calendar day), for "Early". */
      nextSlot: string | null
      /** Slots an Early answer would mark Missed (before `nextSlot`, no dose, not under a dose expectation). */
      earlierOpenSlots: string[]
    }

export type PromptAnswer = "late" | "early" | "extra"

interface ScheduleRow {
  id: number
  person_id: number
  schedule_times: string | null
  schedule_frequency: string | null
  schedule_start_date: string | null
  schedule_end_date: string | null
  schedule_created_at_ms: number | null
  schedule_tz: string | null
}

interface Slot {
  hhmm: string
  ms: number
}

const defaultCalendarFor = (db: Database.Database): CalendarFor => (tz, atMs) => resolveCalendarContext(db, tz, atMs)

/** The schedule's slots on one Calendar day, ascending; empty when the schedule does not run that day. */
function slotsOnYmd(row: ScheduleRow, ctx: CalendarContext, ymd: string): Slot[] {
  const freq = parseScheduleFrequencyUnknown(row.schedule_frequency)
  if (!isScheduleActiveOnYmd(freq, row.schedule_start_date, row.schedule_end_date, ymd)) return []
  const seen = new Set<string>()
  const out: Slot[] = []
  for (const t of parseScheduleTimesJson(row.schedule_times)) {
    const hm = parseHHMM(t)
    if (!hm) continue
    const hhmm = formatHHMM(hm.h, hm.m)
    if (seen.has(hhmm)) continue
    seen.add(hhmm)
    const ms = resolveSlotMs(ctx, ymd, hhmm)
    if (!Number.isFinite(ms)) continue
    if (isSlotBeforeScheduleCreation({ startDate: row.schedule_start_date, createdAtMs: row.schedule_created_at_ms }, ctx, ymd, ms)) continue
    out.push({ hhmm, ms })
  }
  return out.sort((a, b) => a.ms - b.ms)
}

type OutcomeRow = {
  person_medication_id: number
  local_ymd: string
  slot_hhmm: string
  result: SlotResult
  offset_minutes: number | null
  missed_cause: MissedCause | null
  medication_record_id: number | null
}

const toOutcome = (r: OutcomeRow): SlotOutcome => ({
  personMedicationId: r.person_medication_id,
  ymd: r.local_ymd,
  slotHhmm: r.slot_hhmm,
  result: r.result,
  offsetMinutes: r.offset_minutes,
  missedCause: r.missed_cause,
  recordId: r.medication_record_id,
})

const OUTCOME_CHUNK = 250

/** Stored outcomes for the given Person medications on the given Calendar days, ordered by day then slot. */
export function loadSlotOutcomes(
  db: Database.Database,
  personMedicationIds: readonly number[],
  ymds: readonly string[],
): SlotOutcome[] {
  if (personMedicationIds.length === 0 || ymds.length === 0) return []
  // Both lists are chunked so each statement binds at most 2 * OUTCOME_CHUNK variables; the order is restored after.
  const rows = runInChunks(
    personMedicationIds,
    pmChunk =>
      runInChunks(
        ymds,
        ymdChunk =>
          db
            .prepare(
              `SELECT person_medication_id, local_ymd, slot_hhmm, result, offset_minutes, missed_cause, medication_record_id
                 FROM slot_outcomes
                WHERE person_medication_id IN (${pmChunk.map(() => "?").join(",")})
                  AND local_ymd IN (${ymdChunk.map(() => "?").join(",")})`,
            )
            .all(...pmChunk, ...ymdChunk) as OutcomeRow[],
        OUTCOME_CHUNK,
      ),
    OUTCOME_CHUNK,
  )
  rows.sort((a, b) => (a.local_ymd < b.local_ymd ? -1 : a.local_ymd > b.local_ymd ? 1 : a.slot_hhmm < b.slot_hhmm ? -1 : a.slot_hhmm > b.slot_hhmm ? 1 : 0))
  return rows.map(toOutcome)
}

/** Writes an outcome, replacing a Missed one but never a slot that already holds a dose. */
export function upsertSlotOutcome(
  db: Database.Database,
  o: {
    personMedicationId: number
    ymd: string
    slotHhmm: string
    result: SlotResult
    offsetMinutes?: number | null
    missedCause?: MissedCause | null
    recordId?: number | null
  },
): boolean {
  const res = db
    .prepare(
      `INSERT INTO slot_outcomes (person_medication_id, local_ymd, slot_hhmm, result, offset_minutes, missed_cause, medication_record_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(person_medication_id, local_ymd, slot_hhmm) DO UPDATE SET
         result = excluded.result,
         offset_minutes = excluded.offset_minutes,
         missed_cause = excluded.missed_cause,
         medication_record_id = excluded.medication_record_id
       WHERE slot_outcomes.medication_record_id IS NULL`,
    )
    .run(o.personMedicationId, o.ymd, o.slotHhmm, o.result, o.offsetMinutes ?? null, o.missedCause ?? null, o.recordId ?? null)
  return res.changes > 0
}

interface DayContext {
  row: ScheduleRow
  ctx: CalendarContext
  /** Slots keyed by their Calendar day, for the day before, the day of, and the day after. */
  byYmd: Map<string, Slot[]>
  /** Slot keys (`ymd|hhmm`) that already hold a dose. */
  attached: Set<string>
  external: (ymd: string, hhmm: string) => boolean
}

function buildDayContext(db: Database.Database, row: ScheduleRow, ctx: CalendarContext, ymd: string): DayContext {
  const ymds = [addCalendarDaysToIsoYmd(ymd, -1), ymd, addCalendarDaysToIsoYmd(ymd, 1)]
  const byYmd = new Map(ymds.map(d => [d, slotsOnYmd(row, ctx, d)]))
  const attached = new Set(
    loadSlotOutcomes(db, [row.id], ymds)
      .filter(o => o.recordId != null)
      .map(o => `${o.ymd}|${o.slotHhmm}`),
  )
  const state = loadDoseExpectationState(db, [row.id], ymds)
  return {
    row,
    ctx,
    byYmd,
    attached,
    external: (d, hhmm) => isSlotExternal(state.expectations, state.exceptionsByExpectation, row.id, hhmm, d),
  }
}

/** Where a dose at `doseMs` falls: attached on time, or the slots a prompt would offer. */
function classify(dc: DayContext, ymd: string, doseMs: number): DoseTiming {
  const base = { personMedicationId: dc.row.id, ymd }
  let nearest: { ymd: string; slot: Slot } | null = null
  for (const [d, slots] of dc.byYmd) {
    for (const s of slots) {
      const diff = Math.abs(doseMs - s.ms)
      if (diff <= ON_TIME_WINDOW_MS && (!nearest || diff < Math.abs(doseMs - nearest.slot.ms))) {
        nearest = { ymd: d, slot: s }
      }
    }
  }
  if (nearest) {
    if (dc.attached.has(`${nearest.ymd}|${nearest.slot.hhmm}`)) return { kind: "extra" }
    return {
      kind: "on_time",
      personMedicationId: dc.row.id,
      ymd: nearest.ymd,
      slotHhmm: nearest.slot.hhmm,
      offsetMinutes: Math.round((doseMs - nearest.slot.ms) / 60_000),
    }
  }

  const today = dc.byYmd.get(ymd) ?? []
  if (today.length === 0) return { kind: "unscheduled" }
  const before = today.filter(s => s.ms < doseMs)
  const after = today.filter(s => s.ms > doseMs)
  const previous = [...before].reverse().find(s => !dc.attached.has(`${ymd}|${s.hhmm}`)) ?? null
  const next = after.find(s => !dc.attached.has(`${ymd}|${s.hhmm}`)) ?? null
  if (!previous && !next) return { kind: "extra" }
  const earlierOpenSlots = next
    ? today
        .filter(s => s.ms < next.ms && !dc.attached.has(`${ymd}|${s.hhmm}`) && !dc.external(ymd, s.hhmm))
        .map(s => s.hhmm)
    : []
  return { ...base, kind: "needs_prompt", previousSlot: previous?.hhmm ?? null, nextSlot: next?.hhmm ?? null, earlierOpenSlots }
}

const loadScheduleRow = (db: Database.Database, personId: number, medicationId: number): ScheduleRow | undefined =>
  db
    .prepare(
      `SELECT id, person_id, schedule_times, schedule_frequency, schedule_start_date, schedule_end_date, schedule_created_at_ms, schedule_tz
         FROM person_medications
        WHERE person_id = ? AND medication_id = ? AND is_active = 1 AND schedule_times IS NOT NULL`,
    )
    .get(personId, medicationId) as ScheduleRow | undefined

/**
 * Classifies a freshly saved dose. On time attaches silently; outside every window the answer comes
 * back as `needs_prompt` data and nothing is stored. Unscheduled medications are never classified.
 * Runs inside the caller's transaction.
 */
export function classifyAndAttachDose(
  db: Database.Database,
  input: {
    personId: number
    medicationId: number
    recordId: number
    recordedMs: number
    calendarFor?: CalendarFor
  },
): DoseTiming {
  const row = loadScheduleRow(db, input.personId, input.medicationId)
  if (!row) return { kind: "unscheduled" }
  const ctx = (input.calendarFor ?? defaultCalendarFor(db))(row.schedule_tz, input.recordedMs)
  if (!ctx || !Number.isFinite(input.recordedMs)) return { kind: "unscheduled" }
  const ymd = localYmdAt(ctx, input.recordedMs)
  const timing = classify(buildDayContext(db, row, ctx, ymd), ymd, input.recordedMs)
  if (timing.kind === "on_time") {
    upsertSlotOutcome(db, {
      personMedicationId: row.id,
      ymd: timing.ymd,
      slotHhmm: timing.slotHhmm,
      result: "on_time",
      offsetMinutes: timing.offsetMinutes,
      recordId: input.recordId,
    })
  }
  return timing
}

export type AnswerDoseTimingResult =
  | {
      ok: true
      answer: PromptAnswer
      /** True when the dose attached to a slot, so that slot's reminder should be cleared. */
      clearsReminder: boolean
      attachedSlot: { ymd: string; slotHhmm: string } | null
      missed: { personMedicationId: number; ymd: string; slotHhmm: string }[]
    }
  | { ok: false; status: 400 | 404 | 409; error: string }

/**
 * Applies the carer's answer to a "needs prompt" dose. Late attaches to the previous slot, Early to
 * the next (marking every earlier open slot Missed straight away), Extra stores nothing. The prompt
 * is recomputed from the stored dose so the client never names a slot.
 */
export function answerDoseTiming(
  db: Database.Database,
  input: { recordId: number; answer: PromptAnswer; nowMs: number; calendarFor?: CalendarFor },
): AnswerDoseTimingResult {
  const rec = db
    .prepare("SELECT id, person_id, medication_id, recorded_at FROM medication_records WHERE id = ?")
    .get(input.recordId) as { id: number; person_id: number; medication_id: number; recorded_at: string } | undefined
  if (!rec) return { ok: false, status: 404, error: "Not found" }
  if (db.prepare("SELECT 1 FROM slot_outcomes WHERE medication_record_id = ?").get(rec.id)) {
    return { ok: false, status: 409, error: "This dose is already attached to a dose time" }
  }
  const none = { ok: true as const, answer: input.answer, clearsReminder: false, attachedSlot: null, missed: [] }
  if (input.answer === "extra") return none

  const row = loadScheduleRow(db, rec.person_id, rec.medication_id)
  const recordedMs = Date.parse(rec.recorded_at)
  const ctx = row ? (input.calendarFor ?? defaultCalendarFor(db))(row.schedule_tz, recordedMs) : null
  if (!row || !ctx) return { ok: false, status: 400, error: "This medication has no dose times" }
  const ymd = localYmdAt(ctx, recordedMs)
  const dc = buildDayContext(db, row, ctx, ymd)
  const timing = classify(dc, ymd, recordedMs)
  if (timing.kind !== "needs_prompt") return { ok: false, status: 400, error: "This dose is not waiting for an answer" }

  const slotHhmm = input.answer === "late" ? timing.previousSlot : timing.nextSlot
  if (!slotHhmm) return { ok: false, status: 400, error: "There is no dose time to attach this dose to" }
  const slotMs = (dc.byYmd.get(ymd) ?? []).find(s => s.hhmm === slotHhmm)!.ms

  const missed: { personMedicationId: number; ymd: string; slotHhmm: string }[] = []
  db.transaction(() => {
    upsertSlotOutcome(db, {
      personMedicationId: row.id,
      ymd,
      slotHhmm,
      result: input.answer === "late" ? "late" : "early",
      offsetMinutes: Math.round((recordedMs - slotMs) / 60_000),
      recordId: rec.id,
    })
    if (input.answer === "early") {
      for (const hhmm of timing.earlierOpenSlots) {
        const inserted = db
          .prepare(
            `INSERT OR IGNORE INTO slot_outcomes (person_medication_id, local_ymd, slot_hhmm, result, missed_cause)
             VALUES (?, ?, ?, 'missed', 'early_answer')`,
          )
          .run(row.id, ymd, hhmm)
        if (inserted.changes > 0) missed.push({ personMedicationId: row.id, ymd, slotHhmm: hhmm })
      }
    }
  })()
  return { ok: true, answer: input.answer, clearsReminder: true, attachedSlot: { ymd, slotHhmm }, missed }
}

export interface SettleSlotsResult {
  missed: { personMedicationId: number; ymd: string; slotHhmm: string }[]
}

/**
 * Marks slots Missed once the next slot has started, or once the Calendar day has ended for the last
 * one. Slots under a dose expectation never time out, and a slot that already has an outcome is left
 * alone. Safe to call repeatedly (dose write path and cron). `notBeforeMs` skips slots from before
 * this feature existed, whose doses were never attached; it defaults to when the store was created.
 */
export function settleSlots(
  db: Database.Database,
  input: {
    nowMs: number
    calendarFor?: CalendarFor
    notBeforeMs?: number
    /** Limit to one Person (the dose write path); cron settles everyone. */
    personId?: number
  },
): SettleSlotsResult {
  const calendarFor = input.calendarFor ?? defaultCalendarFor(db)
  const notBeforeMs = input.notBeforeMs ?? storeCreatedMs(db)
  const rows = db
    .prepare(
      `SELECT id, person_id, schedule_times, schedule_frequency, schedule_start_date, schedule_end_date, schedule_created_at_ms, schedule_tz
         FROM person_medications
        WHERE is_active = 1 AND schedule_times IS NOT NULL ${input.personId != null ? "AND person_id = ?" : ""}`,
    )
    .all(...(input.personId != null ? [input.personId] : [])) as ScheduleRow[]

  const missed: SettleSlotsResult["missed"] = []
  for (const row of rows) {
    const ctx = calendarFor(row.schedule_tz, input.nowMs)
    if (!ctx) continue
    const today = localYmdAt(ctx, input.nowMs)
    const dc = buildDayContext(db, row, ctx, today)
    const existing = new Set(loadSlotOutcomes(db, [row.id], [...dc.byYmd.keys()]).map(o => `${o.ymd}|${o.slotHhmm}`))
    for (const ymd of [addCalendarDaysToIsoYmd(today, -1), today]) {
      const slots = dc.byYmd.get(ymd) ?? []
      const dayEndMs = resolveSlotMs(ctx, addCalendarDaysToIsoYmd(ymd, 1), "00:00")
      slots.forEach((slot, i) => {
        if (slot.ms < notBeforeMs || existing.has(`${ymd}|${slot.hhmm}`) || dc.external(ymd, slot.hhmm)) return
        const closesAtMs = slots[i + 1]?.ms ?? dayEndMs
        if (input.nowMs < closesAtMs) return
        db.prepare(
          `INSERT OR IGNORE INTO slot_outcomes (person_medication_id, local_ymd, slot_hhmm, result, missed_cause)
           VALUES (?, ?, ?, 'missed', 'timed_out')`,
        ).run(row.id, ymd, slot.hhmm)
        missed.push({ personMedicationId: row.id, ymd, slotHhmm: slot.hhmm })
      })
    }
  }
  return { missed }
}

/** When this store was created on this instance (its migration time); 0 when unknown (fresh database). */
function storeCreatedMs(db: Database.Database): number {
  try {
    const r = db.prepare("SELECT applied_at FROM schema_migrations WHERE id = '030_slot_outcomes'").get() as
      | { applied_at: string }
      | undefined
    // SQLite CURRENT_TIMESTAMP is UTC without a zone marker.
    const ms = r ? Date.parse(`${r.applied_at.replace(" ", "T")}Z`) : NaN
    return Number.isFinite(ms) ? ms : 0
  } catch {
    return 0
  }
}
