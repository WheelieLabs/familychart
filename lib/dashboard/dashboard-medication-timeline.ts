// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { resolveCalendarContext, type CalendarContext } from "@/lib/calendar-context"
import { getDoseTimestampsInWindow } from "@/lib/dashboard/dashboard-dose-queries"
import { addCalendarDaysToIsoYmd, formatHHMM, parseHHMM } from "@/lib/datetime"
import type { Person } from "@/lib/domain-types"
import {
  buildMedicationTimelineLane,
  TIMELINE_WINDOW_HOURS,
  type MedicationTimelineLane,
  type TimelineDose,
  type TimelineSlot,
} from "@/lib/medication/medication-timeline"
import { evaluateMedicationPrnState, isAssignmentScheduledOnYmd } from "@/lib/alert-readiness"
import { doseSliceFromMaps, loadMedicationDoseState } from "@/lib/medication/medication-dose-state"
import { loadSlotEvaluatorConfig } from "@/lib/schedule/schedule-config"
import { isSlotBeforeScheduleCreation, resolveSlotMs } from "@/lib/schedule/schedule-slot-evaluator"
import { loadDoseTimingByRecord } from "@/lib/schedule/slot-outcome-reads"
import { loadSlotOutcomes } from "@/lib/schedule/slot-outcomes"
import {
  isScheduleActiveOnYmd,
  parseScheduleFrequencyUnknown,
  parseScheduleTimesJson,
} from "@/lib/schedule/schedule-recurrence"

type ActiveMedRow = {
  person_medication_id: number
  person_id: number
  medication_id: number
  medication_name: string
  schedule_times: string | null
  schedule_frequency: string | null
  schedule_start_date: string | null
  schedule_end_date: string | null
  schedule_created_at_ms: number | null
  schedule_tz: string | null
}

/**
 * Medication coverage/gap timeline lanes per person. The 24h-cap, coverage-gap and cooldown state
 * for every lane comes from `evaluateMedicationPrnState` (Alert readiness), the same decision the
 * dashboard alert and reminder blocking use. Scheduled slots are enumerated here with the same primitives Alert
 * readiness uses (`resolveSlotMs`, `isScheduleActiveOnYmd`, `isSlotClearedByDose`) but without
 * its alert windows: readiness only emits a slot around its own time, whereas the timeline
 * shows every uncleared slot across the whole trailing window plus the 6h lookahead. A lane exists only for an active assignment that has a dose in the
 * trailing window or something upcoming/possible.
 */
export function buildMedicationTimelines(
  db: Database.Database,
  people: Person[],
  now: Date,
  calCtx: CalendarContext,
): Map<number, MedicationTimelineLane[]> {
  const out = new Map<number, MedicationTimelineLane[]>()
  for (const p of people) out.set(p.id, [])
  if (people.length === 0) return out

  const ids = people.map(p => p.id)
  const rows = db
    .prepare(
      `SELECT pm.id AS person_medication_id, pm.person_id, pm.medication_id, m.name AS medication_name,
              pm.schedule_times, pm.schedule_frequency, pm.schedule_start_date, pm.schedule_end_date, pm.schedule_created_at_ms, pm.schedule_tz
         FROM person_medications pm
         JOIN medications m ON m.id = pm.medication_id
        WHERE pm.is_active = 1 AND m.is_active = 1 AND pm.person_id IN (${ids.map(() => "?").join(",")})
        ORDER BY m.name COLLATE NOCASE`,
    )
    .all(...ids) as ActiveMedRow[]
  if (rows.length === 0) return out

  const nowMs = now.getTime()
  const sinceMs = nowMs - TIMELINE_WINDOW_HOURS * 3_600_000
  const doseState = loadMedicationDoseState(db, people)

  const slotCfg = loadSlotEvaluatorConfig(db)

  // "Scheduled" is Alert readiness' definition, shared so the cap reads the same here as on the
  // dashboard; a medication with several assignments counts if any one is in effect.
  const scheduledMedKeys = new Set<string>()
  for (const row of rows) {
    const ymd = (resolveCalendarContext(db, row.schedule_tz, nowMs) ?? calCtx).ymd
    if (isAssignmentScheduledOnYmd(
      { scheduleTimesRaw: row.schedule_times, scheduleFrequencyRaw: row.schedule_frequency, scheduleStartDate: row.schedule_start_date, scheduleEndDate: row.schedule_end_date },
      ymd,
    )) scheduledMedKeys.add(`${row.person_id}:${row.medication_id}`)
  }

  for (const row of rows) {
    const timesHm = parseScheduleTimesJson(row.schedule_times)
    const hasTimes = timesHm.length > 0
    const freq = hasTimes ? parseScheduleFrequencyUnknown(row.schedule_frequency) : null

    // How each dose sat against its slot is read from the outcome stored when it was saved, not
    // worked out again from today's schedule.
    const doseRows = getDoseTimestampsInWindow(db, row.person_id, row.medication_id, sinceMs)
    const timingByRecord = hasTimes ? loadDoseTimingByRecord(db, doseRows.map(d => d.id)) : new Map()
    const doses: TimelineDose[] = doseRows.map(d => ({
      id: d.id,
      recorded_at: d.recorded_at,
      timing: timingByRecord.get(d.id) ?? null,
    }))

    const slots = hasTimes
      ? scheduledSlotsInTimeline(row, timesHm, freq, nowMs, calCtx, slotCfg, db)
      : []

    const medScheduled = scheduledMedKeys.has(`${row.person_id}:${row.medication_id}`)
    const lane = buildMedicationTimelineLane({
      medicationId: row.medication_id,
      name: row.medication_name,
      doses,
      scheduled: medScheduled,
      prn: evaluateMedicationPrnState(doseSliceFromMaps(doseState, row.person_id, row.medication_id), now, medScheduled),
      slots,
      nowMs,
    })
    if (lane) out.get(row.person_id)?.push(lane)
  }

  return out
}

/**
 * Every scheduled slot of this assignment across the window, with what became of it: a slot a dose
 * attached to is `resolved`, one that ended with no dose is `missed`. An open slot is upcoming
 * (future), "due" while inside the slot window, then "overdue".
 */
function scheduledSlotsInTimeline(
  row: ActiveMedRow,
  timesHm: string[],
  freq: ReturnType<typeof parseScheduleFrequencyUnknown> | null,
  nowMs: number,
  fallbackCalCtx: CalendarContext,
  cfg: ReturnType<typeof loadSlotEvaluatorConfig>,
  db: Database.Database,
): TimelineSlot[] {
  const ctx = resolveCalendarContext(db, row.schedule_tz, nowMs) ?? fallbackCalCtx
  const days = [
    addCalendarDaysToIsoYmd(ctx.ymd, -1),
    ctx.ymd,
    addCalendarDaysToIsoYmd(ctx.ymd, 1),
  ]
  const outcomes = new Map(
    loadSlotOutcomes(db, [row.person_medication_id], days).map(o => [`${o.ymd}|${o.slotHhmm}`, o]),
  )
  const out: TimelineSlot[] = []
  for (const t of timesHm) {
    const hm = parseHHMM(t)
    if (!hm) continue
    const hhmm = formatHHMM(hm.h, hm.m)
    for (const ymd of days) {
      if (!isScheduleActiveOnYmd(freq, row.schedule_start_date, row.schedule_end_date, ymd)) continue
      const slotMs = resolveSlotMs(ctx, ymd, hhmm)
      if (!Number.isFinite(slotMs)) continue
      if (isSlotBeforeScheduleCreation({ startDate: row.schedule_start_date, createdAtMs: row.schedule_created_at_ms }, ctx, ymd, slotMs)) continue
      const outcome = outcomes.get(`${ymd}|${hhmm}`)
      out.push({
        atMs: slotMs,
        status: outcome
          ? outcome.result === "missed" ? "missed" : "resolved"
          : slotMs > nowMs ? "upcoming" : nowMs <= slotMs + cfg.slotWindowMs ? "due" : "overdue",
      })
    }
  }
  return out
}
