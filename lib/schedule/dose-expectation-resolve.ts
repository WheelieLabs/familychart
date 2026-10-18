// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import type { CalendarContext } from "@/lib/calendar-context"
import { recordDose } from "@/lib/medication/record-dose"
import { expectationAppliesOnYmd } from "@/lib/schedule/dose-expectation"
import { loadDoseExpectationState } from "@/lib/schedule/dose-expectation-store"
import { dosageForScheduledTime } from "@/lib/schedule/schedule-recurrence"
import { resolveSlotMs } from "@/lib/schedule/schedule-slot-evaluator"
import { upsertSlotOutcome } from "@/lib/schedule/slot-outcomes"

/** "Not yet" hides a pending prompt for this long, then it comes back. */
export const SNOOZE_MS = 60 * 60_000

export type DoseExpectationAnswer = "given" | "missed" | "not_yet"

export type ResolveDoseExpectationResult =
  | { ok: true; outcome: "confirmed_given" | "confirmed_missed" | "snoozed"; recordId: number | null; personId: number; medicationId: number }
  | { ok: false; status: 400 | 404 | 409; error: string }

type ExpectationContextRow = {
  person_medication_id: number
  person_id: number
  medication_id: number
  schedule_slots: string | null
  schedule_tz: string | null
  default_dosage: number | null
}

/**
 * Applies the parent's answer to a pending dose expectation.
 *
 * - given: creates a real dose via the shared write path, recorded at the slot time and tagged
 *   "away from home", so every safety check treats it like any other dose.
 * - missed: history only — no record, no alert, no effect on any safety check.
 * - not_yet: snoozes the prompt; it reappears after {@link SNOOZE_MS}.
 *
 * A day already confirmed as given can't be answered again (that would duplicate the dose); a
 * snoozed or missed answer can still be replaced.
 */
export function resolveDoseExpectation(
  db: Database.Database,
  input: {
    expectationId: number
    ymd: string
    outcome: DoseExpectationAnswer
    nowMs: number
    /** Calendar context for the person-medication's schedule timezone. */
    resolveCalendar: (scheduleTz: string | null) => CalendarContext | null
    actor: string | null
  },
): ResolveDoseExpectationResult {
  const row = db
    .prepare(
      `SELECT de.person_medication_id, pm.person_id, pm.medication_id, pm.schedule_slots, pm.schedule_tz,
              m.default_dosage
         FROM dose_expectations de
         JOIN person_medications pm ON pm.id = de.person_medication_id
         JOIN medications m ON m.id = pm.medication_id
        WHERE de.id = ? AND pm.is_active = 1`,
    )
    .get(input.expectationId) as ExpectationContextRow | undefined
  if (!row) return { ok: false, status: 404, error: "Not found" }

  const state = loadDoseExpectationState(db, [row.person_medication_id], [input.ymd])
  const expectation = state.expectations.find(e => e.id === input.expectationId)
  if (!expectation) return { ok: false, status: 404, error: "Not found" }
  if (!expectationAppliesOnYmd(expectation, state.exceptionsByExpectation.get(expectation.id) ?? new Set(), input.ymd)) {
    return { ok: false, status: 400, error: "This expectation does not apply on that day" }
  }

  const existing = state.outcomes.find(o => o.expectationId === expectation.id && o.localYmd === input.ymd)
  if (existing?.status === "confirmed_given") {
    return { ok: false, status: 409, error: "This dose has already been confirmed as given" }
  }

  // Only today's dose can be answered, in the schedule's own timezone — never a client-supplied day.
  const calCtx = input.resolveCalendar(row.schedule_tz)
  if (!calCtx) return { ok: false, status: 400, error: "Could not work out the local time for this schedule" }
  if (input.ymd !== calCtx.ymd) return { ok: false, status: 400, error: "Only today's dose can be answered" }

  const upsert = (status: string, snoozedUntil: string | null, recordId: number | null, slotAt: string): void => {
    db.prepare(
      `INSERT INTO dose_expectation_outcomes (dose_expectation_id, local_ymd, status, snoozed_until, slot_at, medication_record_id, resolved_by, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(dose_expectation_id, local_ymd) DO UPDATE SET
         status = excluded.status,
         snoozed_until = excluded.snoozed_until,
         slot_at = excluded.slot_at,
         medication_record_id = excluded.medication_record_id,
         resolved_by = excluded.resolved_by,
         resolved_at = excluded.resolved_at`,
    ).run(expectation.id, input.ymd, status, snoozedUntil, slotAt, recordId, input.actor, new Date(input.nowMs).toISOString())
  }

  const slotMs = resolveSlotMs(calCtx, input.ymd, expectation.slotHhmm)
  if (!Number.isFinite(slotMs)) return { ok: false, status: 400, error: "Could not work out the dose time" }
  // Every answer needs the dose time to have come: nobody can pre-answer or snooze a future day.
  if (slotMs > input.nowMs) return { ok: false, status: 400, error: "That dose time has not happened yet" }
  const slotAt = new Date(slotMs).toISOString()

  if (input.outcome === "missed") {
    upsert("confirmed_missed", null, null, slotAt)
    // One Missed state: "Not given" is a Missed slot straight away.
    upsertSlotOutcome(db, {
      personMedicationId: row.person_medication_id,
      ymd: input.ymd,
      slotHhmm: expectation.slotHhmm,
      result: "missed",
      missedCause: "not_given",
    })
    return { ok: true, outcome: "confirmed_missed", recordId: null, personId: row.person_id, medicationId: row.medication_id }
  }

  if (input.outcome === "not_yet") {
    // A confirmed miss stays confirmed; "not yet" must not reopen the prompt.
    if (existing?.status === "confirmed_missed") {
      return { ok: true, outcome: "confirmed_missed", recordId: null, personId: row.person_id, medicationId: row.medication_id }
    }
    upsert("snoozed", new Date(input.nowMs + SNOOZE_MS).toISOString(), null, slotAt)
    return { ok: true, outcome: "snoozed", recordId: null, personId: row.person_id, medicationId: row.medication_id }
  }

  const confirm = db.transaction((): ResolveDoseExpectationResult => {
    const recorded = recordDose(db, {
      personId: row.person_id,
      medicationId: row.medication_id,
      recordedAt: slotAt,
      dosage: dosageForScheduledTime(expectation.slotHhmm, row.schedule_slots, row.default_dosage),
      administeredBy: "away_from_home",
      createdBy: input.actor,
      nowMs: input.nowMs,
      skipTiming: true,
    })
    if (!recorded.ok) return { ok: false, status: 400, error: recorded.error }
    upsert("confirmed_given", null, recorded.recordId, slotAt)
    // Attached with no timing label; the slot time is the recorded time.
    upsertSlotOutcome(db, {
      personMedicationId: row.person_medication_id,
      ymd: input.ymd,
      slotHhmm: expectation.slotHhmm,
      result: "given",
      recordId: recorded.recordId,
    })
    return { ok: true, outcome: "confirmed_given", recordId: recorded.recordId, personId: row.person_id, medicationId: row.medication_id }
  })
  return confirm()
}
