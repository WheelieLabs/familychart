// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import type { Person } from "@/lib/domain-types"
import {
  isObservationOverdue,
  nextDueDisplay,
  type ObservationScheduleContext,
  type PersonObservationExpectationRow,
} from "@/lib/observation/observation-recurrence"
import { fractionalAgeYears } from "@/lib/person/person-age"

export type EnrichedObservationExpectation = PersonObservationExpectationRow & {
  last_recorded_at: string | null
  next_due_at: string | null
}

/** Key: `${personId}:${observation_type}` → MAX(recorded_at). */
export function loadLastObservationAtByPersonType(
  db: Database.Database,
  personIds: number[],
): Map<string, string> {
  const out = new Map<string, string>()
  if (personIds.length === 0) return out

  const placeholders = personIds.map(() => "?").join(",")
  const rows = db
    .prepare(
      `SELECT person_id, observation_type, MAX(recorded_at) AS last_at
         FROM observations
        WHERE person_id IN (${placeholders})
        GROUP BY person_id, observation_type`,
    )
    .all(...personIds) as { person_id: number; observation_type: string; last_at: string }[]

  for (const r of rows) {
    out.set(`${r.person_id}:${r.observation_type}`, r.last_at)
  }
  return out
}

/** Key: observation_type → MAX(recorded_at) for one person. */
export function loadLastObservationAtByType(
  db: Database.Database,
  personId: number,
): Map<string, string> {
  const out = new Map<string, string>()
  const rows = db
    .prepare(
      `SELECT observation_type, MAX(recorded_at) AS last_at
         FROM observations
        WHERE person_id = ?
        GROUP BY observation_type`,
    )
    .all(personId) as { observation_type: string; last_at: string }[]
  for (const r of rows) out.set(r.observation_type, r.last_at)
  return out
}

export function loadLastObservationAt(
  db: Database.Database,
  personId: number,
  observationType: string,
): string | null {
  const row = db
    .prepare(
      `SELECT MAX(recorded_at) AS last_at FROM observations
        WHERE person_id = ? AND observation_type = ? COLLATE NOCASE`,
    )
    .get(personId, observationType) as { last_at: string | null } | undefined
  return row?.last_at ?? null
}

export function lastObservationAtFromMap(
  lastByKey: Map<string, string>,
  personId: number,
  observationType: string,
): string | null {
  return lastByKey.get(`${personId}:${observationType}`) ?? null
}

export function enrichExpectation(
  row: PersonObservationExpectationRow,
  lastAt: string | null,
  dateOfBirth: string | null,
  sched: ObservationScheduleContext,
  instanceIanaTz: string | null,
): EnrichedObservationExpectation {
  const nd = nextDueDisplay(lastAt, row, dateOfBirth, sched, instanceIanaTz)
  return {
    ...row,
    last_recorded_at: lastAt,
    next_due_at: nd ? nd.toISOString() : null,
  }
}

/** Expectations API adapter: load rows + last-at + next-due for one person. */
export function listEnrichedExpectationsForPerson(
  db: Database.Database,
  personId: number,
  person: Pick<Person, "date_of_birth">,
  sched: ObservationScheduleContext,
  instanceIanaTz: string | null,
): EnrichedObservationExpectation[] {
  const rows = db
    .prepare(
      "SELECT * FROM person_observation_expectations WHERE person_id = ? ORDER BY observation_type COLLATE NOCASE",
    )
    .all(personId) as PersonObservationExpectationRow[]

  const lastByType = loadLastObservationAtByType(db, personId)
  return rows.map(row =>
    enrichExpectation(
      row,
      lastByType.get(row.observation_type) ?? null,
      person.date_of_birth,
      sched,
      instanceIanaTz,
    ),
  )
}

/** Single-row enrich for POST/PATCH responses (one MAX query). */
export function enrichSingleExpectation(
  db: Database.Database,
  person: Pick<Person, "date_of_birth">,
  row: PersonObservationExpectationRow,
  sched: ObservationScheduleContext,
  instanceIanaTz: string | null,
): EnrichedObservationExpectation {
  const lastAt = loadLastObservationAt(db, row.person_id, row.observation_type)
  return enrichExpectation(row, lastAt, person.date_of_birth, sched, instanceIanaTz)
}

/** Dashboard / cron overdue check using a preloaded last-at map. */
export function isExpectationOverdue(
  row: PersonObservationExpectationRow,
  lastAt: string | null,
  dateOfBirth: string | null,
  now: Date,
  instanceIanaTz: string | null | undefined,
): boolean {
  return isObservationOverdue(lastAt, row, dateOfBirth, now, instanceIanaTz)
}

/**
 * Full alert eligibility: overdue AND the observation type has a catalogue entry AND the
 * person hasn't aged out of it (`max_age_years`). Shared by dashboard's amber issue and cron's
 * push — cron previously checked overdue only, so it could push for an unconfigured type or one
 * that no longer applies to the person's age, cases the dashboard already hid.
 */
export function isObservationAlertEligible(
  row: PersonObservationExpectationRow,
  lastAt: string | null,
  dateOfBirth: string | null,
  now: Date,
  instanceIanaTz: string | null | undefined,
  catalogueConfig: { max_age_years: number | null } | undefined,
): boolean {
  if (catalogueConfig == null) return false
  if (catalogueConfig.max_age_years != null && dateOfBirth?.trim()) {
    const age = fractionalAgeYears(dateOfBirth, instanceIanaTz ?? "UTC", now)
    if (Number.isFinite(age) && age > catalogueConfig.max_age_years) return false
  }
  return isExpectationOverdue(row, lastAt, dateOfBirth, now, instanceIanaTz)
}