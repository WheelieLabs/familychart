// SPDX-License-Identifier: AGPL-3.0-only

import { parseTestAttachmentUrl } from "../test-results/attachment-url"
import { resolveEffectiveIanaTz } from "../instance-timezone"
import { symptomStoredDateToYmd } from "../symptoms/symptom-dates"
import type Database from "better-sqlite3-multiple-ciphers"
import { APP_VERSION } from "../version"
import { extname } from "path"
import { EXPORT_FORMAT_VERSION, MANIFEST_ENTRY, type ExportManifest, type SkippedFile } from "../export/export-manifest"
import type { ExportEntry } from "../export/export-zip-stream"
import { readUpload, uploadExists, type UploadBucket } from "../uploads/store"
import { loadPersonExportPayload, type PersonExportPayload } from "./person-export-payload"

export type { PersonExportPayload } from "./person-export-payload"

/** The structured payload of a standalone Person export. */
export const PERSON_PAYLOAD_ENTRY = "person.json"

export interface PersonExportPerson {
  id: number
  name: string
  full_name: string | null
  date_of_birth: string | null
  photo_url: string | null
}

export interface AdministrationExportRow {
  recorded_at: string
  medication_name: string
  dosage: number | null
  dosage_unit: string | null
  comments: string | null
  /** Who gave the dose — null on rows predating this field. */
  administered_by: string | null
}

export interface ObservationExportRow {
  recorded_at: string
  observation_type: string
  value: number
  unit: string
  value_label: string | null
  comments: string | null
}

export interface TestResultValueExport {
  metric_name: string
  value_type: string
  limit_qualifier: string | null
  numeric_value: number | null
  qualitative_value: string | null
  unit: string | null
  reference_range: string | null
  flag: string | null
}

export interface TestResultExport {
  date: string
  name: string
  test_type: string
  ordered_by: string | null
  notes: string | null
  /** File name of the report under attachments/, null when there is none or the file is missing. */
  attachment: string | null
  values: TestResultValueExport[]
}

export interface SymptomExportRow {
  label: string
  start_date: string
  end_date: string | null
  severity: number
  is_resolved: number
  resolved_at: string | null
  notes: string | null
}

/** A symptom/dose link, described by both records so it reads without ids. */
export interface SymptomDoseLinkExportRow {
  symptom_label: string
  symptom_start_date: string
  medication_name: string
  dose_recorded_at: string
}

export interface PersonExportData {
  person: PersonExportPerson
  administrations: AdministrationExportRow[]
  observations: ObservationExportRow[]
  test_results: TestResultExport[]
  symptoms: SymptomExportRow[]
  symptom_dose_links: SymptomDoseLinkExportRow[]
}

/**
 * Gathers a person's full record — administrations, observations, test results and
 * symptoms, native units as recorded, no cross-form summing or unit conversion — that is out of v1 scope.
 * Returns null if the person doesn't exist.
 */
export function getPersonExportData(db: Database.Database, personId: number): PersonExportData | null {
  const person = db
    .prepare("SELECT id, name, full_name, date_of_birth, photo_url FROM people WHERE id = ?")
    .get(personId) as PersonExportPerson | undefined
  if (!person) return null

  const administrations = db
    .prepare(
      `SELECT mr.recorded_at, m.name AS medication_name, mr.dosage, mr.dosage_unit, mr.comments, mr.administered_by
       FROM medication_records mr
       JOIN medications m ON m.id = mr.medication_id
       WHERE mr.person_id = ?
       ORDER BY mr.recorded_at ASC, mr.id ASC`,
    )
    .all(personId) as AdministrationExportRow[]

  const observations = db
    .prepare(
      `SELECT recorded_at, observation_type, value, unit, value_label, comments
       FROM observations
       WHERE person_id = ?
       ORDER BY recorded_at ASC, id ASC`,
    )
    .all(personId) as ObservationExportRow[]

  const testEvents = db
    .prepare(
      `SELECT id, date, name, test_type, ordered_by, notes, attachment_url
       FROM test_events
       WHERE person_id = ?
       ORDER BY date ASC, id ASC`,
    )
    .all(personId) as (Omit<TestResultExport, "attachment" | "values"> & { id: number; attachment_url: string | null })[]
  const valueStmt = db.prepare(
    `SELECT metric_name, value_type, limit_qualifier, numeric_value, qualitative_value, unit, reference_range, flag
     FROM test_result_values
     WHERE test_event_id = ?
     ORDER BY id ASC`,
  )
  const test_results: TestResultExport[] = testEvents.map(e => ({
    date: e.date,
    name: e.name,
    test_type: e.test_type,
    ordered_by: e.ordered_by,
    notes: e.notes,
    attachment: parseTestAttachmentUrl(e.attachment_url),
    values: valueStmt.all(e.id) as TestResultValueExport[],
  }))

  // A symptom is recorded for a day, so it is exported as that date, not as the stored midnight timestamp.
  let instanceTz: string | null = null
  try {
    instanceTz = resolveEffectiveIanaTz(null, db)
  } catch {
    /* no timezone setting available: the zone-free rule still recovers the day */
  }
  const symptoms = (db
    .prepare(
      `SELECT label, start_date, end_date, severity, is_resolved, resolved_at, notes
       FROM symptom_events
       WHERE person_id = ?
       ORDER BY start_date ASC, id ASC`,
    )
    .all(personId) as SymptomExportRow[]).map(row => ({
      ...row,
      start_date: symptomStoredDateToYmd(row.start_date, instanceTz) ?? row.start_date,
      end_date: symptomStoredDateToYmd(row.end_date, instanceTz),
    }))

  const symptom_dose_links = db
    .prepare(
      `SELECT s.label AS symptom_label, s.start_date AS symptom_start_date,
              m.name AS medication_name, mr.recorded_at AS dose_recorded_at
       FROM symptom_dose_links l
       JOIN symptom_events s ON s.id = l.symptom_event_id
       JOIN medication_records mr ON mr.id = l.medication_record_id
       JOIN medications m ON m.id = mr.medication_id
       WHERE l.person_id = ?
       ORDER BY mr.recorded_at ASC, l.symptom_event_id ASC, mr.id ASC`,
    )
    .all(personId) as SymptomDoseLinkExportRow[]

  return { person, administrations, observations, test_results, symptoms, symptom_dose_links }
}

function csvEscape(value: string | number | null): string {
  if (value === null || value === undefined) return ""
  let s = String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv<T>(columns: (keyof T & string)[], rows: T[]): string {
  const lines = [columns.join(",")]
  for (const row of rows) {
    lines.push(columns.map(col => csvEscape(row[col] as string | number | null)).join(","))
  }
  return lines.join("\r\n") + "\r\n"
}

const ADMINISTRATION_COLUMNS: (keyof AdministrationExportRow)[] = [
  "recorded_at", "medication_name", "dosage", "dosage_unit", "comments", "administered_by",
]
const OBSERVATION_COLUMNS: (keyof ObservationExportRow)[] = [
  "recorded_at", "observation_type", "value", "unit", "value_label", "comments",
]

interface TestResultCsvRow {
  date: string
  name: string
  test_type: string
  ordered_by: string | null
  notes: string | null
  attachment: string | null
  metric_name: string | null
  value_type: string | null
  limit_qualifier: string | null
  numeric_value: number | null
  qualitative_value: string | null
  unit: string | null
  reference_range: string | null
  flag: string | null
}

const TEST_RESULT_COLUMNS: (keyof TestResultCsvRow)[] = [
  "date", "name", "test_type", "ordered_by", "notes", "attachment",
  "metric_name", "value_type", "limit_qualifier", "numeric_value", "qualitative_value",
  "unit", "reference_range", "flag",
]
const SYMPTOM_COLUMNS: (keyof SymptomExportRow)[] = [
  "label", "start_date", "end_date", "severity", "is_resolved", "resolved_at", "notes",
]

const SYMPTOM_DOSE_LINK_COLUMNS: (keyof SymptomDoseLinkExportRow)[] = [
  "symptom_label", "symptom_start_date", "medication_name", "dose_recorded_at",
]

export function symptomDoseLinksToCsv(rows: SymptomDoseLinkExportRow[]): string {
  return toCsv(SYMPTOM_DOSE_LINK_COLUMNS, rows)
}

/** One row per value with the parent fields repeated; an event with no values gets one blank-value row. */
export function testResultsToCsv(results: TestResultExport[]): string {
  const rows: TestResultCsvRow[] = []
  for (const r of results) {
    const parent = {
      date: r.date, name: r.name, test_type: r.test_type, ordered_by: r.ordered_by,
      notes: r.notes, attachment: r.attachment,
    }
    if (r.values.length === 0) {
      rows.push({
        ...parent, metric_name: null, value_type: null, limit_qualifier: null, numeric_value: null,
        qualitative_value: null, unit: null, reference_range: null, flag: null,
      })
    } else {
      for (const v of r.values) rows.push({ ...parent, ...v })
    }
  }
  return toCsv(TEST_RESULT_COLUMNS, rows)
}

export function symptomsToCsv(rows: SymptomExportRow[]): string {
  return toCsv(SYMPTOM_COLUMNS, rows)
}

export function administrationsToCsv(rows: AdministrationExportRow[]): string {
  return toCsv(ADMINISTRATION_COLUMNS, rows)
}

export function observationsToCsv(rows: ObservationExportRow[]): string {
  return toCsv(OBSERVATION_COLUMNS, rows)
}

/** Bundle file name keeping only a short, safe extension from the stored name. */
function bundleFileName(stem: string, stored: string): string {
  const ext = extname(stored).toLowerCase()
  return /^\.[a-z0-9]{1,5}$/.test(ext) ? `${stem}${ext}` : stem
}

function uploadLoader(bucket: UploadBucket, filename: string): () => Promise<Buffer> {
  return async () => {
    const buffer = await readUpload(bucket, filename)
    if (!buffer) throw new Error(`Upload ${bucket}/${filename} disappeared during export`)
    return buffer
  }
}

async function isReadable(bucket: UploadBucket, filename: string): Promise<boolean> {
  try {
    return await uploadExists(bucket, filename)
  } catch {
    return false
  }
}

/** Record counts per section: the Person counts as one, and the catalogue flag lists are not records. */
export function personExportCounts(payload: PersonExportPayload): Record<string, number> {
  const counts: Record<string, number> = { person: 1 }
  for (const [section, value] of Object.entries(payload)) {
    if (Array.isArray(value)) counts[section] = value.length
  }
  return counts
}

export interface PersonExport {
  person: { id: number; name: string }
  manifest: ExportManifest
  /** Every entry in archive order, the manifest first. */
  entries: ExportEntry[]
}

/**
 * Builds a standalone Person export: the manifest, the structured payload, readable CSV copies
 * and the photo and report files. Entry names use bundle-local names only, never a Person's name
 * or a stored file name. Files are checked for presence now and read only while streaming.
 * Returns null when the Person doesn't exist.
 */
export async function buildPersonExport(db: Database.Database, personId: number, exportedAt: Date): Promise<PersonExport | null> {
  const payload = loadPersonExportPayload(db, personId)
  const csv = getPersonExportData(db, personId)
  if (!payload || !csv) return null

  const attachments: ExportEntry[] = []
  const skipped_files: SkippedFile[] = []

  if (payload.person.photo) {
    const stored = payload.person.photo.original_name
    const path = `attachments/${bundleFileName("photo", stored)}`
    if (await isReadable("people", stored)) {
      payload.person.photo.file = path
      attachments.push({ name: path, content: uploadLoader("people", stored) })
    } else {
      skipped_files.push({ path, reason: "The photo file is missing from storage" })
    }
  }

  const reportPaths = new Map<string, string | null>()
  for (const result of payload.test_results) {
    if (!result.report) continue
    const stored = result.report.original_name
    if (!reportPaths.has(stored)) {
      const path = `attachments/${bundleFileName(`report-${reportPaths.size + 1}`, stored)}`
      if (await isReadable("test-results", stored)) {
        reportPaths.set(stored, path)
        attachments.push({ name: path, content: uploadLoader("test-results", stored) })
      } else {
        reportPaths.set(stored, null)
        skipped_files.push({ path, reason: "The report file is missing from storage" })
      }
    }
    result.report.file = reportPaths.get(stored) ?? null
  }

  const readableTestResults = csv.test_results.map(r => ({
    ...r,
    attachment: r.attachment ? (reportPaths.get(r.attachment)?.replace("attachments/", "") ?? null) : null,
  }))

  const manifest: ExportManifest = {
    format_version: EXPORT_FORMAT_VERSION,
    scope: "person",
    app_version: APP_VERSION,
    exported_at: exportedAt.toISOString(),
    sections: Object.keys(payload),
    counts: { ...personExportCounts(payload), attachments: attachments.length },
    skipped_files,
  }

  const entries: ExportEntry[] = [
    { name: MANIFEST_ENTRY, content: JSON.stringify(manifest, null, 2) },
    { name: PERSON_PAYLOAD_ENTRY, content: JSON.stringify(payload, null, 2) },
    { name: "csv/administrations.csv", content: administrationsToCsv(csv.administrations) },
    { name: "csv/observations.csv", content: observationsToCsv(csv.observations) },
    { name: "csv/test_results.csv", content: testResultsToCsv(readableTestResults) },
    { name: "csv/symptoms.csv", content: symptomsToCsv(csv.symptoms) },
    { name: "csv/symptom_dose_links.csv", content: symptomDoseLinksToCsv(csv.symptom_dose_links) },
    ...attachments,
  ]
  return { person: { id: payload.person.db_id, name: payload.person.name }, manifest, entries }
}
