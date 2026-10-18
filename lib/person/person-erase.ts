// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { logger } from "@/lib/logger"
import { auditLog } from "@/lib/audit-log"
import { removeAccount } from "@/lib/account/remove-account"
import { chunkItems, runInChunks } from "@/lib/sql-chunks"
import { deleteUpload, type UploadBucket } from "@/lib/uploads/store"

export const ERASE_AGAIN =
  "If you ever restore a backup taken before this date, erase this person again."

export interface PersonEraseCounts {
  doses: number
  observations: number
  test_results: number
  symptoms: number
  symptom_links: number
  assignments: number
  dose_expectations: number
  slot_outcomes: number
  goals: number
  observation_expectations: number
  favourites: number
  notification_preferences: number
  notification_history: number
  push_dedupe: number
  files: number
}

export interface PersonEraseFileFailure {
  path: string
  reason: string
}

export interface PersonEraseResult {
  erased_at: string
  erase_again: string
  counts: PersonEraseCounts
  file_failures: PersonEraseFileFailure[]
}

interface StoredFile {
  bucket: UploadBucket
  filename: string
}

interface AuditRef {
  entity_type: string
  entity_id: number
}

function numberIds(db: Database.Database, sql: string, ...params: number[]): number[] {
  return (db.prepare(sql).all(...params) as { id: number }[]).map(row => row.id)
}

function numberIdsIn(db: Database.Database, table: string, column: string, parentIds: number[]): number[] {
  return runInChunks(parentIds, chunk =>
    numberIds(db, `SELECT id FROM ${table} WHERE ${column} IN (${chunk.map(() => "?").join(", ")})`, ...chunk),
  )
}

function deleteIn(db: Database.Database, table: string, column: string, ids: number[]): void {
  for (const chunk of chunkItems(ids)) {
    db.prepare(`DELETE FROM ${table} WHERE ${column} IN (${chunk.map(() => "?").join(", ")})`).run(...chunk)
  }
}

/**
 * The push-log ids whose dedupe key matches any pattern. A Person with a long history has one pattern per
 * dose, and SQLite refuses an OR chain deeper than 1000 terms, so the patterns are tried in chunks.
 */
function matchingPushLogIds(db: Database.Database, clauses: string[], params: (string | number)[]): number[] {
  const CHUNK = 200
  const ids = new Set<number>()
  for (let start = 0; start < clauses.length; start += CHUNK) {
    const where = clauses.slice(start, start + CHUNK).join(" OR ")
    const rows = db.prepare(`SELECT id FROM push_log WHERE ${where}`).all(...params.slice(start, start + CHUNK)) as { id: number }[]
    for (const row of rows) ids.add(row.id)
  }
  return [...ids]
}

function storedFilename(url: string | null): string | null {
  if (!url) return null
  const name = url.split("/").pop() ?? ""
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) return null
  return name
}

function fileStillUsed(db: Database.Database, personId: number, bucket: UploadBucket, filename: string): boolean {
  if (bucket === "people") {
    const photos = db.prepare(
      "SELECT photo_url FROM people WHERE id != ? AND photo_url IS NOT NULL",
    ).all(personId) as { photo_url: string }[]
    return photos.some(row => storedFilename(row.photo_url) === filename)
  }
  const reports = db.prepare(
    "SELECT attachment_url FROM test_events WHERE person_id != ? AND attachment_url IS NOT NULL",
  ).all(personId) as { attachment_url: string }[]
  return reports.some(row => storedFilename(row.attachment_url) === filename)
}

/**
 * Hard-deletes one Person and everything keyed to them, blanks audit content for those
 * records, and writes one Person-erased row. Files are removed after the transaction commits.
 * Does not change Accounts.
 */
export async function erasePerson(
  db: Database.Database,
  personId: number,
  actorEmail: string | null,
  now: Date,
  options?: { removeAccountId?: number; actorRole?: string },
): Promise<PersonEraseResult> {
  const committed = db.transaction(() => {
    const doseIds = numberIds(db, "SELECT id FROM medication_records WHERE person_id = ?", personId)
    const observationIds = numberIds(db, "SELECT id FROM observations WHERE person_id = ?", personId)
    const testEventIds = numberIds(db, "SELECT id FROM test_events WHERE person_id = ?", personId)
    const symptomIds = numberIds(db, "SELECT id FROM symptom_events WHERE person_id = ?", personId)
    const assignmentIds = numberIds(db, "SELECT id FROM person_medications WHERE person_id = ?", personId)
    const expectationIds = numberIds(
      db,
      `SELECT id FROM dose_expectations WHERE person_medication_id IN (
         SELECT id FROM person_medications WHERE person_id = ?
       )`,
      personId,
    )
    const goalIds = numberIds(db, "SELECT id FROM observation_goals WHERE person_id = ?", personId)
    const observationExpectationIds = numberIds(
      db, "SELECT id FROM person_observation_expectations WHERE person_id = ?", personId,
    )
    const favouriteIds = numberIds(db, "SELECT id FROM favourites WHERE person_id = ?", personId)
    const prefIds = numberIds(db, "SELECT id FROM person_notification_prefs WHERE person_id = ?", personId)
    const historyIds = numberIds(db, "SELECT id FROM notification_log WHERE person_id = ?", personId)
    const valueIds = numberIdsIn(db, "test_result_values", "test_event_id", testEventIds)
    const exceptionIds = numberIdsIn(db, "dose_expectation_exceptions", "dose_expectation_id", expectationIds)
    const outcomeIds = numberIdsIn(db, "dose_expectation_outcomes", "dose_expectation_id", expectationIds)
    // Both statements on slot_outcomes below use the leading column of its unique (person_medication_id, ...) index.
    const slotOutcomeCount = (db.prepare(
      `SELECT COUNT(*) AS n FROM slot_outcomes
       WHERE person_medication_id IN (SELECT id FROM person_medications WHERE person_id = ?)`,
    ).get(personId) as { n: number }).n
    const symptomLinkCount = (db.prepare(
      "SELECT COUNT(*) AS n FROM symptom_dose_links WHERE person_id = ?",
    ).get(personId) as { n: number }).n

    const photo = storedFilename(
      (db.prepare("SELECT photo_url FROM people WHERE id = ?").get(personId) as { photo_url: string | null }).photo_url,
    )
    const reports = (db.prepare(
      "SELECT attachment_url FROM test_events WHERE person_id = ? AND attachment_url IS NOT NULL",
    ).all(personId) as { attachment_url: string }[])
      .map(row => storedFilename(row.attachment_url))
      .filter((name): name is string => name != null)

    const files: StoredFile[] = []
    const seen = new Set<string>()
    const consider = (bucket: UploadBucket, filename: string | null) => {
      if (!filename) return
      const key = `${bucket}/${filename}`
      if (seen.has(key) || fileStillUsed(db, personId, bucket, filename)) return
      seen.add(key)
      files.push({ bucket, filename })
    }
    consider("people", photo)
    for (const report of reports) consider("test-results", report)

    const pushClauses: string[] = []
    const pushParams: (string | number)[] = []
    for (const id of doseIds) {
      pushClauses.push("ref_key = ?")
      pushParams.push(`prn:${id}`)
    }
    for (const id of assignmentIds) {
      pushClauses.push("ref_key GLOB ?")
      pushParams.push(`scheduled:${id}:*`)
      pushClauses.push("ref_key GLOB ?")
      pushParams.push(`overdue:${id}:*`)
    }
    for (const id of expectationIds) {
      pushClauses.push("ref_key GLOB ?")
      pushParams.push(`dose-expectation:${id}:*`)
    }
    for (const id of observationExpectationIds) {
      pushClauses.push("ref_key GLOB ?")
      pushParams.push(`observation:${id}:*`)
    }
    pushClauses.push("ref_key GLOB ?")
    pushParams.push(`hydration:${personId}:*`)
    const pushIds = matchingPushLogIds(db, pushClauses, pushParams)
    const pushCount = pushIds.length

    const counts: PersonEraseCounts = {
      doses: doseIds.length,
      observations: observationIds.length,
      test_results: testEventIds.length,
      symptoms: symptomIds.length,
      symptom_links: symptomLinkCount,
      assignments: assignmentIds.length,
      dose_expectations: expectationIds.length,
      slot_outcomes: slotOutcomeCount,
      goals: goalIds.length,
      observation_expectations: observationExpectationIds.length,
      favourites: favouriteIds.length,
      notification_preferences: prefIds.length,
      notification_history: historyIds.length,
      push_dedupe: pushCount,
      files: files.length,
    }

    const refs: AuditRef[] = [
      { entity_type: "people", entity_id: personId },
      ...doseIds.map(entity_id => ({ entity_type: "medication_records", entity_id })),
      ...observationIds.map(entity_id => ({ entity_type: "observations", entity_id })),
      ...testEventIds.map(entity_id => ({ entity_type: "test_events", entity_id })),
      ...valueIds.map(entity_id => ({ entity_type: "test_result_values", entity_id })),
      ...symptomIds.map(entity_id => ({ entity_type: "symptom_events", entity_id })),
      ...assignmentIds.map(entity_id => ({ entity_type: "person_medications", entity_id })),
      ...expectationIds.map(entity_id => ({ entity_type: "dose_expectations", entity_id })),
      ...exceptionIds.map(entity_id => ({ entity_type: "dose_expectation_exceptions", entity_id })),
      ...outcomeIds.map(entity_id => ({ entity_type: "dose_expectation_outcomes", entity_id })),
      ...goalIds.map(entity_id => ({ entity_type: "observation_goals", entity_id })),
      ...observationExpectationIds.map(entity_id => ({ entity_type: "person_observation_expectations", entity_id })),
      ...favouriteIds.map(entity_id => ({ entity_type: "favourites", entity_id })),
      ...prefIds.map(entity_id => ({ entity_type: "person_notification_prefs", entity_id })),
      ...historyIds.map(entity_id => ({ entity_type: "notification_log", entity_id })),
    ]
    const blank = db.prepare(
      "UPDATE audit_log SET details = NULL WHERE entity_type = ? AND entity_id = ?",
    )
    for (const ref of refs) blank.run(ref.entity_type, ref.entity_id)
    const detailRows = db.prepare(
      "SELECT id, details FROM audit_log WHERE details IS NOT NULL",
    ).all() as { id: number; details: string }[]
    const blankById = db.prepare("UPDATE audit_log SET details = NULL WHERE id = ?")
    for (const row of detailRows) {
      try {
        const parsed = JSON.parse(row.details) as { person_id?: unknown }
        if (parsed?.person_id === personId) blankById.run(row.id)
      } catch {
        // Non-JSON details are not a person record.
      }
    }

    db.prepare("DELETE FROM symptom_dose_links WHERE person_id = ?").run(personId)
    // Explicit rather than left to the foreign-key cascades, so the count above is exactly what goes.
    db.prepare(
      "DELETE FROM slot_outcomes WHERE person_medication_id IN (SELECT id FROM person_medications WHERE person_id = ?)",
    ).run(personId)
    deleteIn(db, "prn_push_requests", "medication_record_id", doseIds)
    deleteIn(db, "dose_expectation_outcomes", "dose_expectation_id", expectationIds)
    deleteIn(db, "dose_expectation_exceptions", "dose_expectation_id", expectationIds)
    deleteIn(db, "dose_expectations", "id", expectationIds)
    deleteIn(db, "test_result_values", "test_event_id", testEventIds)
    db.prepare("DELETE FROM test_events WHERE person_id = ?").run(personId)
    db.prepare("DELETE FROM symptom_events WHERE person_id = ?").run(personId)
    db.prepare("DELETE FROM medication_records WHERE person_id = ?").run(personId)
    db.prepare("DELETE FROM observations WHERE person_id = ?").run(personId)
    db.prepare("DELETE FROM person_medications WHERE person_id = ?").run(personId)
    db.prepare("DELETE FROM person_observation_expectations WHERE person_id = ?").run(personId)
    db.prepare("DELETE FROM observation_goals WHERE person_id = ?").run(personId)
    db.prepare("DELETE FROM favourites WHERE person_id = ?").run(personId)
    db.prepare("DELETE FROM person_notification_prefs WHERE person_id = ?").run(personId)
    db.prepare("DELETE FROM notification_log WHERE person_id = ?").run(personId)
    deleteIn(db, "push_log", "id", pushIds)
    db.prepare("DELETE FROM people WHERE id = ?").run(personId)

    auditLog(db, actorEmail, "ERASE", "people", null, { event: "Person erased", counts })
    if (options?.removeAccountId != null) {
      removeAccount(db, options.removeAccountId, actorEmail, options.actorRole ?? "admin")
    }
    return { counts, files, erased_at: now.toISOString() }
  })()

  const file_failures: PersonEraseFileFailure[] = []
  for (const file of committed.files) {
    try {
      await deleteUpload(file.bucket, file.filename)
    } catch {
      const reason = "The file could not be deleted"
      logger.error("person_erase_file_failed")
      file_failures.push({ path: `${file.bucket}/${file.filename}`, reason })
    }
  }

  return {
    erased_at: committed.erased_at,
    erase_again: ERASE_AGAIN,
    counts: committed.counts,
    file_failures,
  }
}
