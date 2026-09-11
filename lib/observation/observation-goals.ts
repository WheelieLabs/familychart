// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import type { ObservationGoal } from "../domain-types"

export function getObservationGoal(
  db: Database.Database,
  personId: number,
  observationType: string
): ObservationGoal | null {
  return (
    db
      .prepare(
        `SELECT * FROM observation_goals
         WHERE person_id = ? AND observation_type = ? AND is_active = 1 LIMIT 1`
      )
      .get(personId, observationType) ?? null
  ) as ObservationGoal | null
}

export function setObservationGoal(
  db: Database.Database,
  personId: number,
  observationType: string,
  goalType: string,
  targetValue: number,
  targetMax: number | null,
  unit: string,
  targetDate: string | null = null
): void {
  db.prepare(
    `INSERT INTO observation_goals
       (person_id, observation_type, goal_type, target_value, target_max, unit, target_date, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(person_id, observation_type, goal_type)
     DO UPDATE SET target_value = excluded.target_value,
                   target_max   = excluded.target_max,
                   unit         = excluded.unit,
                   target_date  = excluded.target_date,
                   is_active    = 1`
  ).run(personId, observationType, goalType, targetValue, targetMax, unit, targetDate)
}

export function deleteObservationGoal(
  db: Database.Database,
  personId: number,
  observationType: string
): void {
  db.prepare(
    `UPDATE observation_goals SET is_active = 0
     WHERE person_id = ? AND observation_type = ?`
  ).run(personId, observationType)
}
