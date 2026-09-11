// SPDX-License-Identifier: AGPL-3.0-only

import { randomUUID } from "crypto"
import type Database from "better-sqlite3-multiple-ciphers"
import { auditLog } from "@/lib/audit-log"
import { normalizeObservationLabel } from "@/lib/observation/observation-type-meta"
import { validateObservationWrite } from "@/lib/observation/observation-validation"
import { clearSupersededPrnPushRequests } from "@/lib/prn/prn-push-supersede"
import {
  validateMedicationRecordWrite,
  validateRecordDosage,
  validateRecordTiming,
} from "@/lib/medication/medication-record-validation"
import { ensureActivePersonMedicationLink } from "@/lib/person/person-medication-assign"

export type ImportRecordType = "medication" | "observation" | "blood_pressure_pair"

export interface MedicationImportRecord {
  record_type?: "medication"
  date: string
  time: string | null
  medication_name: string
  dosage: number | null
  dosage_unit: string | null
  weight_kg: number | null
  comments: string | null
}

export interface ObservationImportRecord {
  record_type: "observation"
  date: string
  time: string | null
  observation_type: string
  value: number
  unit: string
  comments: string | null
}

export interface BpPairImportRecord {
  record_type: "blood_pressure_pair"
  date: string
  time: string | null
  systolic: number
  diastolic: number
  comments: string | null
}

export type ImportRecord = MedicationImportRecord | ObservationImportRecord | BpPairImportRecord

export interface ImportResult {
  imported: number
  observationsCreated: number
  errors: string[]
}

function recordedIso(date: string, time: string | null): string {
  return new Date(`${date}T${time ?? "00:00"}:00`).toISOString()
}

function requireRecordedAt(iso: string): string {
  const timing = validateRecordTiming(iso)
  if (!timing.ok) throw new Error(timing.error)
  return timing.recordedAt
}

function importMedication(
  db: Database.Database,
  rec: MedicationImportRecord,
  personId: number,
  userEmail: string | null,
  canCreateCatalogue: boolean,
): { medsImported: number; observationsCreated: number } {
  const recordedAt = `${rec.date}T${rec.time ?? "00:00"}:00`

  let med = db
    .prepare("SELECT id FROM medications WHERE name = ? COLLATE NOCASE")
    .get(rec.medication_name) as { id: number } | undefined

  if (!med) {
    // Only catalogue-capable callers (global readwrite+) may create global medication
    // rows; a personal-link / read-only writer can import against existing meds only.
    if (!canCreateCatalogue) {
      throw new Error(
        `Medication "${rec.medication_name}" does not exist (no permission to create it)`,
      )
    }
    // Validate the medication-independent fields BEFORE inserting the catalogue row so a
    // bad row leaves no orphan medication when the per-row error is collected.
    const timing = validateRecordTiming(recordedAt)
    if (!timing.ok) throw new Error(timing.error)
    const dosageCheck = validateRecordDosage(rec.dosage)
    if (!dosageCheck.ok) throw new Error(dosageCheck.error)

    const result = db
      .prepare("INSERT INTO medications (name, dosage_unit, is_active) VALUES (?, ?, 1)")
      .run(rec.medication_name, rec.dosage_unit ?? "Tabs")
    med = { id: Number(result.lastInsertRowid) }
    auditLog(db, userEmail, "CREATE", "medications", med.id, {
      name: rec.medication_name,
      source: "spreadsheet_import",
    })
  }

  // Thread person_id for the age check. The person↔medication link is not required here
  // (requirePersonLink: false) — import is the manager catalogue/history tool and assigns the
  // medication to the person below so future interactive writes satisfy the link requirement.
  const validatedRecord = validateMedicationRecordWrite(
    db,
    {
      medication_id: med.id,
      recorded_at: recordedAt,
      dosage: rec.dosage,
      dosage_unit: rec.dosage_unit,
      person_id: personId,
    },
    { requirePersonLink: false },
  )
  if (!validatedRecord.ok) throw new Error(validatedRecord.error)

  // Validate the weight side-effect up-front so a bad value rejects the whole row
  // rather than committing the dose record without its paired observation.
  const validatedWeight =
    rec.weight_kg != null
      ? validateObservationWrite(db, { observation_type: "Weight", value: rec.weight_kg })
      : null
  if (validatedWeight && !validatedWeight.ok) throw new Error(validatedWeight.error)

  ensureActivePersonMedicationLink(db, personId, med.id, userEmail, "import")

  const insertResult = db.prepare(
    `INSERT INTO medication_records
     (person_id, medication_id, recorded_at, dosage, dosage_unit, comments, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(personId, med.id, validatedRecord.recordedAt, validatedRecord.dosage, validatedRecord.dosageUnit, rec.comments ?? null, userEmail)

  // Import clears superseded PRN push requests same as POST /api/records, silently.
  clearSupersededPrnPushRequests(db, {
    personId,
    medicationId: med.id,
    currentRecordId: Number(insertResult.lastInsertRowid),
    recordedAt: validatedRecord.recordedAt,
  })

  let observationsCreated = 0
  if (validatedWeight && validatedWeight.ok) {
    const weightIso = requireRecordedAt(new Date(recordedAt).toISOString())
    db.prepare(
      `INSERT INTO observations (person_id, observation_type, value, unit, recorded_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(personId, validatedWeight.observationType, validatedWeight.value, "kg", weightIso, userEmail)
    observationsCreated++
  }

  return { medsImported: 1, observationsCreated }
}

function importObservation(
  db: Database.Database,
  rec: ObservationImportRecord,
  personId: number,
  userEmail: string | null,
): void {
  const iso = requireRecordedAt(recordedIso(rec.date, rec.time))
  const oLabel = normalizeObservationLabel(rec.observation_type)
  const validated = validateObservationWrite(db, {
    observation_type: oLabel,
    value: rec.value,
  })
  if (!validated.ok) {
    throw new Error(validated.error)
  }
  db.prepare(
    `INSERT INTO observations
     (person_id, observation_type, value, unit, recorded_at, comments, created_by, session_id, value_label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    personId,
    validated.observationType,
    validated.value,
    rec.unit,
    iso,
    rec.comments ?? null,
    userEmail,
    null,
    null,
  )
}

function importBpPair(
  db: Database.Database,
  rec: BpPairImportRecord,
  personId: number,
  userEmail: string | null,
): void {
  const iso = requireRecordedAt(recordedIso(rec.date, rec.time))
  const systolic = validateObservationWrite(db, { observation_type: "Blood Pressure", value: rec.systolic })
  if (!systolic.ok) throw new Error(systolic.error)
  const diastolic = validateObservationWrite(db, { observation_type: "Blood Pressure", value: rec.diastolic })
  if (!diastolic.ok) throw new Error(diastolic.error)
  const sid = randomUUID()
  const ins = db.prepare(
    `INSERT INTO observations
     (person_id, observation_type, value, unit, recorded_at, comments, created_by, session_id, value_label)
     VALUES (?, 'Blood Pressure', ?, 'mmHg', ?, ?, ?, ?, ?)`,
  )
  ins.run(personId, systolic.value, iso, rec.comments ?? null, userEmail, sid, "Systolic")
  ins.run(personId, diastolic.value, iso, rec.comments ?? null, userEmail, sid, "Diastolic")
}

function recordHint(raw: ImportRecord): string {
  if (raw.record_type === "observation") return `${raw.observation_type} on ${raw.date}`
  if (raw.record_type === "blood_pressure_pair") return `BP on ${raw.date}`
  return `${(raw as MedicationImportRecord).medication_name} on ${raw.date}`
}

/**
 * Imports a batch of records for a person inside a single transaction.
 * Medication auto-creation, weight side-effects, and BP pair expansion
 * are all handled here. Per-record errors are collected rather than aborting.
 */
export function importRecords(
  db: Database.Database,
  personId: number,
  records: ImportRecord[],
  userEmail: string | null,
  canCreateCatalogue: boolean,
): ImportResult {
  let imported = 0
  let observationsCreated = 0
  const errors: string[] = []

  const transaction = db.transaction(() => {
    for (const raw of records) {
      try {
        const rt: ImportRecordType =
          raw.record_type === "observation" || raw.record_type === "blood_pressure_pair"
            ? raw.record_type
            : "medication"

        if (rt === "medication") {
          const counts = importMedication(db, raw as MedicationImportRecord, personId, userEmail, canCreateCatalogue)
          imported += counts.medsImported
          observationsCreated += counts.observationsCreated
        } else if (rt === "observation") {
          importObservation(db, raw as ObservationImportRecord, personId, userEmail)
          observationsCreated++
        } else {
          importBpPair(db, raw as BpPairImportRecord, personId, userEmail)
          observationsCreated += 2
        }
      } catch (e) {
        errors.push(`${recordHint(raw)}: ${(e as Error).message}`)
      }
    }
  })

  transaction()
  return { imported, observationsCreated, errors }
}
