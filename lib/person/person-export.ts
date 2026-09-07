// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { ZipArchive, type Archiver } from "archiver"

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
}

export interface ObservationExportRow {
  recorded_at: string
  observation_type: string
  value: number
  unit: string
  value_label: string | null
  comments: string | null
}

export interface PersonExportData {
  person: PersonExportPerson
  administrations: AdministrationExportRow[]
  observations: ObservationExportRow[]
}

/**
 * Gathers a person's full record — administrations and observations, native
 * units as recorded, no cross-form summing or unit conversion — that is out of v1 scope.
 * Returns null if the person doesn't exist.
 */
export function getPersonExportData(db: Database.Database, personId: number): PersonExportData | null {
  const person = db
    .prepare("SELECT id, name, full_name, date_of_birth, photo_url FROM people WHERE id = ?")
    .get(personId) as PersonExportPerson | undefined
  if (!person) return null

  const administrations = db
    .prepare(
      `SELECT mr.recorded_at, m.name AS medication_name, mr.dosage, mr.dosage_unit, mr.comments
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

  return { person, administrations, observations }
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
  "recorded_at", "medication_name", "dosage", "dosage_unit", "comments",
]
const OBSERVATION_COLUMNS: (keyof ObservationExportRow)[] = [
  "recorded_at", "observation_type", "value", "unit", "value_label", "comments",
]

export function administrationsToCsv(rows: AdministrationExportRow[]): string {
  return toCsv(ADMINISTRATION_COLUMNS, rows)
}

export function observationsToCsv(rows: ObservationExportRow[]): string {
  return toCsv(OBSERVATION_COLUMNS, rows)
}

/** Full-fidelity JSON bundle — same records as the CSVs, structured. */
export function personExportJson(data: PersonExportData): string {
  return JSON.stringify(
    {
      person: {
        id: data.person.id,
        name: data.person.name,
        full_name: data.person.full_name,
        date_of_birth: data.person.date_of_birth,
      },
      administrations: data.administrations,
      observations: data.observations,
    },
    null,
    2,
  )
}

export interface PersonExportAttachment {
  filename: string
  buffer: Buffer
}

function zipToBuffer(archive: Archiver): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    archive.on("data", (chunk: Buffer) => chunks.push(chunk))
    archive.on("error", reject)
    archive.on("end", () => resolve(Buffer.concat(chunks)))
  })
}

/**
 * Assembles the export zip: data/*.csv, data.json, and attachments/ (person
 * photo only for v1.0.0; test-result-file attachments are deferred to a
 * post-1.0.0 follow-up).
 */
export async function buildPersonExportZip(
  data: PersonExportData,
  photo: PersonExportAttachment | null,
): Promise<Buffer> {
  const archive = new ZipArchive({ zlib: { level: 9 } })
  const zipPromise = zipToBuffer(archive)

  archive.append(administrationsToCsv(data.administrations), { name: "data/administrations.csv" })
  archive.append(observationsToCsv(data.observations), { name: "data/observations.csv" })
  archive.append(personExportJson(data), { name: "data.json" })
  if (photo) {
    archive.append(photo.buffer, { name: `attachments/${photo.filename}` })
  }

  await archive.finalize()
  return zipPromise
}
