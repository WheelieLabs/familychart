// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { getGroupSiblingIds } from "@/lib/frequency-rule"

export interface ClearSupersededPrnPushRequestsInput {
  personId: number
  medicationId: number
  /** The medication_records row that triggered this clear — never deletes its own request. */
  currentRecordId: number
  recordedAt: string
}

/**
 * Hard-deletes pending prn_push_requests made stale by a newer dose for the same person +
 * medication (or sibling group, via getGroupSiblingIds — same clock as last-dose/cooldown).
 * Chronological: only clears requests tied to doses with an earlier recorded_at, so a
 * backdated entry never wipes a later, still-valid request. Equal recorded_at breaks the tie
 * on medication_record_id. Never deletes the current record's own request. Call inside the
 * same DB transaction as the triggering insert/update.
 *
 * Returns the number of requests cleared that were still pending (never delivered — see
 * `push_log`, keyed `prn:<medication_record_id>`) — i.e. an upcoming reminder that's now moot
 * because the caregiver already redosed, which is the only case worth telling them about. A
 * request that had already been delivered before this dose was recorded is deleted too (it's
 * stale either way), but isn't counted: nothing is being pre-emptively cancelled, so surfacing
 * a "reminder cancelled" notice for it would be misleading (the reminder already happened, or
 * should have — a delivery-timing problem, not a cancellation).
 */
export function clearSupersededPrnPushRequests(
  db: Database.Database,
  { personId, medicationId, currentRecordId, recordedAt }: ClearSupersededPrnPushRequestsInput,
): number {
  const siblingIds = getGroupSiblingIds(db, medicationId)
  const medPlaceholders = siblingIds.map(() => "?").join(",")
  const staleIds = (
    db
      .prepare(
        `SELECT ppr.medication_record_id AS id
         FROM prn_push_requests ppr
         JOIN medication_records mr ON mr.id = ppr.medication_record_id
         WHERE mr.person_id = ?
           AND mr.medication_id IN (${medPlaceholders})
           AND mr.id != ?
           AND (mr.recorded_at < ? OR (mr.recorded_at = ? AND mr.id < ?))`,
      )
      .all(personId, ...siblingIds, currentRecordId, recordedAt, recordedAt, currentRecordId) as {
      id: number
    }[]
  ).map(r => r.id)

  if (staleIds.length === 0) return 0

  const refKeys = staleIds.map(id => `prn:${id}`)
  const sentCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM push_log WHERE ref_key IN (${refKeys.map(() => "?").join(",")})`,
      )
      .get(...refKeys) as { n: number }
  ).n

  const idPlaceholders = staleIds.map(() => "?").join(",")
  db.prepare(`DELETE FROM prn_push_requests WHERE medication_record_id IN (${idPlaceholders})`).run(
    ...staleIds,
  )

  return staleIds.length - sentCount
}
