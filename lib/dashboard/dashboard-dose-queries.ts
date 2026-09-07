// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import type { FrequencyRule } from "@/lib/domain-types"
import { getGroupSiblingIds, ruleMax24hIsDoseCount } from "@/lib/frequency-rule"

/** Latest dose time, chosen remind offset, and sibling medication name for this med/group. */
export function getLastGroupDoseWithOffset(
  db: Database.Database,
  personId: number,
  medicationId: number,
): { lastIso: string; remindAfterHours: number | null; lastMedName: string | null } | null {
  const sibIds = getGroupSiblingIds(db, medicationId)
  const ph = sibIds.map(() => "?").join(",")
  const row = db.prepare(
    `SELECT mr.recorded_at AS last_dose_at, ppr.remind_after_hours, m.name AS last_med_name
       FROM medication_records mr
       LEFT JOIN prn_push_requests ppr ON ppr.medication_record_id = mr.id
       LEFT JOIN medications m ON m.id = mr.medication_id
       WHERE mr.person_id = ? AND mr.medication_id IN (${ph})
       ORDER BY mr.recorded_at DESC LIMIT 1`,
  ).get(personId, ...sibIds) as { last_dose_at: string; remind_after_hours: number | null; last_med_name: string | null } | undefined
  if (!row) return null
  return { lastIso: row.last_dose_at, remindAfterHours: row.remind_after_hours ?? null, lastMedName: row.last_med_name ?? null }
}

/** Oldest recorded_at in the rolling 24h window for this medication — used to compute when cap resets. */
export function getOldestIn24hWindow(
  db: Database.Database,
  personId: number,
  medicationId: number,
): string | null {
  const row = db.prepare(
    `SELECT MIN(mr.recorded_at) AS oldest_at
       FROM medication_records mr
       WHERE mr.person_id = ?
         AND datetime(mr.recorded_at) >= datetime('now', '-24 hours')
         AND mr.medication_id = ?`,
  ).get(personId, medicationId) as { oldest_at: string | null } | undefined
  return row?.oldest_at ?? null
}

/** Fallback dose-size estimate for quantity-mode cap/gap when rule and catalogue dosage are both null. */
export function getLastRecordedDosageForMed(
  db: Database.Database,
  personId: number,
  medicationId: number,
): number | null {
  const sibIds = getGroupSiblingIds(db, medicationId)
  const ph = sibIds.map(() => "?").join(",")
  const row = db.prepare(
    `SELECT mr.dosage
       FROM medication_records mr
       WHERE mr.person_id = ?
         AND mr.dosage IS NOT NULL AND mr.dosage > 0
         AND mr.medication_id IN (${ph})
       ORDER BY mr.recorded_at DESC LIMIT 1`,
  ).get(personId, ...sibIds) as { dosage: number } | undefined
  return row?.dosage ?? null
}

/** Rolling 24h total for max checks — form-local (own medication_id only). */
export function getTotalTaken24hForMed(
  db: Database.Database,
  personId: number,
  medicationId: number,
  rule: FrequencyRule,
  catalogDosageUnit: string,
): number {
  if (rule.max_quantity_per_24h == null) return 0

  if (ruleMax24hIsDoseCount(rule)) {
    const totRow = db.prepare(
      `SELECT COUNT(*) AS total_taken_24h
         FROM medication_records mr
        WHERE mr.person_id = ?
          AND datetime(mr.recorded_at) >= datetime('now', '-24 hours')
          AND mr.medication_id = ?`,
    ).get(personId, medicationId) as { total_taken_24h: number } | undefined
    return totRow?.total_taken_24h ?? 0
  }

  const totRow = db.prepare(
    `SELECT COALESCE(SUM(mr.dosage), 0) AS total_taken_24h
       FROM medication_records mr
       WHERE mr.person_id = ?
         AND datetime(mr.recorded_at) >= datetime('now', '-24 hours')
         AND mr.dosage_unit = ?
         AND mr.medication_id = ?`,
  ).get(personId, catalogDosageUnit, medicationId) as { total_taken_24h: number } | undefined

  return totRow?.total_taken_24h ?? 0
}
