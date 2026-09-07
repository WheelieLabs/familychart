// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { auditLog } from "@/lib/audit-log"

export type PersonMedicationAssignVia = "record_dose" | "import"

/**
 * Ensures an active `person_medications` link for `(personId, medicationId)`, creating it
 * when absent and reactivating a soft-deleted (`is_active = 0`) row.
 *
 * The interactive dose-write path requires a pre-existing link (to close a security gap
 * where doses could be recorded against medications never linked to the person), but the
 * Record Medication screen lets a caregiver record any catalogue medication (or add a
 * brand-new one) ad hoc — so a strict pre-existing-link requirement rejects every dose for
 * an unassigned medication ("Failed to save"). Recording a dose is itself an act of
 * assigning the medication to the person, so the record path calls this to uphold the
 * invariant ("every recorded dose has an active person_medications link") without forcing
 * a manager to pre-assign every PRN/ad-hoc medication first. Spreadsheet import uses the
 * same module so soft-deleted links are reactivated rather than left inactive by
 * INSERT OR IGNORE. Age bounds are still enforced upstream by
 * `validateMedicationRecordWrite`, so an age-ineligible medication never reaches here.
 *
 * @returns `"created"` when a new link was inserted, `"reactivated"` when an inactive link
 *          was switched back on, or `"unchanged"` when an active link already existed.
 */
export function ensureActivePersonMedicationLink(
  db: Database.Database,
  personId: number,
  medicationId: number,
  createdBy: string | null | undefined,
  via: PersonMedicationAssignVia = "record_dose",
): "created" | "reactivated" | "unchanged" {
  const existing = db
    .prepare(
      "SELECT id, is_active FROM person_medications WHERE person_id = ? AND medication_id = ?",
    )
    .get(personId, medicationId) as { id: number; is_active: number } | undefined

  if (!existing) {
    const res = db
      .prepare(
        "INSERT INTO person_medications (person_id, medication_id, is_active) VALUES (?, ?, 1)",
      )
      .run(personId, medicationId)
    auditLog(db, createdBy, "CREATE", "person_medications", Number(res.lastInsertRowid), {
      person_id: personId,
      medication_id: medicationId,
      via,
    })
    return "created"
  }

  if (existing.is_active !== 1) {
    db.prepare("UPDATE person_medications SET is_active = 1 WHERE id = ?").run(existing.id)
    auditLog(db, createdBy, "UPDATE", "person_medications", existing.id, {
      person_id: personId,
      medication_id: medicationId,
      is_active: 1,
      via,
    })
    return "reactivated"
  }

  return "unchanged"
}
