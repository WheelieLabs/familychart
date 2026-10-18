// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import {
  administrationsToCsv,
  getPersonExportData,
  observationsToCsv,
  symptomDoseLinksToCsv,
  symptomsToCsv,
  testResultsToCsv,
} from "@/lib/person/person-export"
import { loadPersonExportPayload } from "@/lib/person/person-export-payload"
import { uploadByteSize } from "@/lib/uploads/store"

export interface PersonExportEstimate {
  totalBytes: number
  reportBytes: number
}

async function storedBytes(bucket: "people" | "test-results", filename: string): Promise<number> {
  try {
    return (await uploadByteSize(bucket, filename)) ?? 0
  } catch {
    return 0
  }
}

/**
 * Bytes a Person export will carry, without reading attachment bodies into the zip.
 * Report files are counted once. A missing file contributes nothing.
 * Returns null when the Person does not exist.
 */
export async function estimatePersonExportBytes(
  db: Database.Database,
  personId: number,
): Promise<PersonExportEstimate | null> {
  const payload = loadPersonExportPayload(db, personId)
  const csv = getPersonExportData(db, personId)
  if (!payload || !csv) return null

  let reportBytes = 0
  const seenReports = new Set<string>()
  for (const result of payload.test_results) {
    const name = result.report?.original_name
    if (!name || seenReports.has(name)) continue
    seenReports.add(name)
    reportBytes += await storedBytes("test-results", name)
  }

  const photoBytes = payload.person.photo
    ? await storedBytes("people", payload.person.photo.original_name)
    : 0

  const structuredBytes = Buffer.byteLength(JSON.stringify(payload), "utf8")
    + Buffer.byteLength(administrationsToCsv(csv.administrations), "utf8")
    + Buffer.byteLength(observationsToCsv(csv.observations), "utf8")
    + Buffer.byteLength(testResultsToCsv(csv.test_results), "utf8")
    + Buffer.byteLength(symptomsToCsv(csv.symptoms), "utf8")
    + Buffer.byteLength(symptomDoseLinksToCsv(csv.symptom_dose_links), "utf8")

  return { totalBytes: reportBytes + photoBytes + structuredBytes, reportBytes }
}
