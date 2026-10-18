// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import type {
  DoseExpectation,
  ExpectationOutcome,
  ExpectationOutcomeStatus,
} from "@/lib/schedule/dose-expectation"

type ExpectationRow = {
  id: number
  person_medication_id: number
  slot_hhmm: string
  start_date: string
  end_date: string
  weekdays: string | null
}

export interface DoseExpectationState {
  expectations: DoseExpectation[]
  exceptionsByExpectation: Map<number, Set<string>>
  outcomes: ExpectationOutcome[]
}

export function parseWeekdaysJson(raw: string | null): number[] | null {
  if (raw == null || raw.trim() === "") return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const days = parsed.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6)
    return days.length > 0 ? days : null
  } catch {
    return null
  }
}

export function toDoseExpectation(row: ExpectationRow): DoseExpectation {
  return {
    id: row.id,
    personMedicationId: row.person_medication_id,
    slotHhmm: row.slot_hhmm,
    startDate: row.start_date,
    endDate: row.end_date,
    weekdays: parseWeekdaysJson(row.weekdays),
  }
}

/**
 * Loads the expectations for the given person-medications, their exception days, and the outcomes
 * recorded on `ymds` (the local days the caller is evaluating).
 */
export function loadDoseExpectationState(
  db: Database.Database,
  personMedicationIds: readonly number[],
  ymds: readonly string[],
): DoseExpectationState {
  const empty: DoseExpectationState = { expectations: [], exceptionsByExpectation: new Map(), outcomes: [] }
  if (personMedicationIds.length === 0) return empty

  const rows = db
    .prepare(
      `SELECT id, person_medication_id, slot_hhmm, start_date, end_date, weekdays
         FROM dose_expectations
        WHERE person_medication_id IN (${personMedicationIds.map(() => "?").join(",")})`,
    )
    .all(...personMedicationIds) as ExpectationRow[]
  if (rows.length === 0) return empty

  const ids = rows.map(r => r.id)
  const idPh = ids.map(() => "?").join(",")

  const exceptionsByExpectation = new Map<number, Set<string>>()
  const exceptionRows = db
    .prepare(`SELECT dose_expectation_id, local_ymd FROM dose_expectation_exceptions WHERE dose_expectation_id IN (${idPh})`)
    .all(...ids) as { dose_expectation_id: number; local_ymd: string }[]
  for (const r of exceptionRows) {
    const set = exceptionsByExpectation.get(r.dose_expectation_id) ?? new Set<string>()
    set.add(r.local_ymd)
    exceptionsByExpectation.set(r.dose_expectation_id, set)
  }

  const outcomes: ExpectationOutcome[] = []
  if (ymds.length > 0) {
    const outcomeRows = db
      .prepare(
        `SELECT dose_expectation_id, local_ymd, status, snoozed_until
           FROM dose_expectation_outcomes
          WHERE dose_expectation_id IN (${idPh}) AND local_ymd IN (${ymds.map(() => "?").join(",")})`,
      )
      .all(...ids, ...ymds) as {
      dose_expectation_id: number
      local_ymd: string
      status: ExpectationOutcomeStatus
      snoozed_until: string | null
    }[]
    for (const r of outcomeRows) {
      const until = r.snoozed_until ? new Date(r.snoozed_until).getTime() : NaN
      outcomes.push({
        expectationId: r.dose_expectation_id,
        localYmd: r.local_ymd,
        status: r.status,
        snoozedUntilMs: Number.isFinite(until) ? until : null,
      })
    }
  }

  return { expectations: rows.map(toDoseExpectation), exceptionsByExpectation, outcomes }
}

export interface DoseExpectationOwner {
  expectationId: number
  personMedicationId: number
  personId: number
  medicationId: number
  medicationName: string
  scheduleTimes: string | null
}

/** Who an expectation belongs to — for authorisation and for validating edits against the schedule. */
export function getDoseExpectationOwner(db: Database.Database, expectationId: number): DoseExpectationOwner | null {
  const row = db
    .prepare(
      `SELECT de.id AS expectation_id, de.person_medication_id, pm.person_id, pm.medication_id,
              m.name AS medication_name, pm.schedule_times
         FROM dose_expectations de
         JOIN person_medications pm ON pm.id = de.person_medication_id
         JOIN medications m ON m.id = pm.medication_id
        WHERE de.id = ?`,
    )
    .get(expectationId) as
    | {
        expectation_id: number
        person_medication_id: number
        person_id: number
        medication_id: number
        medication_name: string
        schedule_times: string | null
      }
    | undefined
  if (!row) return null
  return {
    expectationId: row.expectation_id,
    personMedicationId: row.person_medication_id,
    personId: row.person_id,
    medicationId: row.medication_id,
    medicationName: row.medication_name,
    scheduleTimes: row.schedule_times,
  }
}
