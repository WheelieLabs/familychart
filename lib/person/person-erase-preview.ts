// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { parseLocalAccountUid } from "@/lib/account/account-uid"
import { isLastLocalAdmin, LAST_LOCAL_ADMIN_ERROR } from "@/lib/account/last-local-admin"
import { isOwnAccount } from "@/lib/account/own-account"
import { isNoneRole } from "@/lib/account/none-role"
import { formatCount } from "@/lib/format-count"

export const BACKUP_NOTICE =
  "Backups taken before this erase may still contain this person."

export interface PersonEraseAccountOption {
  email: string
  role: string
  /** On for Role None, off for an Account that has a household Role. */
  remove_default: boolean
  remove_blocked_reason: string | null
  /** The signed-in user's own Account: removing it needs a fresh sign-in first. */
  is_own: boolean
  is_local: boolean
  mfa_enrolled: boolean
}

export interface PersonErasePreview {
  name: string
  is_active: number
  counts_label: string
  backup_notice: string
  account: PersonEraseAccountOption | null
}

/** The sentence shown before erase. It does not delete anything. */
export function eraseCountsLabel(counts: {
  doses: number
  observations: number
  test_results_with_reports: number
  photos: number
}): string {
  return [
    formatCount(counts.doses, "dose"),
    formatCount(counts.observations, "observation"),
    `${formatCount(counts.test_results_with_reports, "test result")} with reports`,
    formatCount(counts.photos, "photo"),
  ].join(", ")
}

/** Counts a Person's records for the confirmation screen. Does not delete anything. */
export function previewPersonErase(
  db: Database.Database,
  personId: number,
  sessionUserId?: string,
): PersonErasePreview | null {
  const person = db.prepare(
    "SELECT name, is_active, photo_url FROM people WHERE id = ?",
  ).get(personId) as { name: string; is_active: number; photo_url: string | null } | undefined
  if (!person) return null

  const doses = (db.prepare(
    "SELECT COUNT(*) AS n FROM medication_records WHERE person_id = ?",
  ).get(personId) as { n: number }).n
  const observations = (db.prepare(
    "SELECT COUNT(*) AS n FROM observations WHERE person_id = ?",
  ).get(personId) as { n: number }).n
  const reports = (db.prepare(
    "SELECT COUNT(*) AS n FROM test_events WHERE person_id = ? AND attachment_url IS NOT NULL AND attachment_url != ''",
  ).get(personId) as { n: number }).n

  const linked = db.prepare("SELECT account_uid FROM people WHERE id = ?").get(personId) as { account_uid: string | null }
  const account = linkedAccount(db, linked.account_uid, sessionUserId)

  return {
    name: person.name,
    is_active: person.is_active,
    counts_label: eraseCountsLabel({
      doses,
      observations,
      test_results_with_reports: reports,
      photos: person.photo_url ? 1 : 0,
    }),
    backup_notice: BACKUP_NOTICE,
    account,
  }
}

function linkedAccount(
  db: Database.Database,
  accountUid: string | null,
  sessionUserId?: string,
): PersonEraseAccountOption | null {
  if (!accountUid) return null
  const localId = parseLocalAccountUid(accountUid)
  const row = (localId != null
    ? db.prepare("SELECT id, email, role, external_id, auth_method, totp_secret FROM accounts WHERE id = ?").get(localId)
    : db.prepare("SELECT id, email, role, external_id, auth_method, totp_secret FROM accounts WHERE external_id = ?").get(accountUid)
  ) as {
    id: number; email: string; role: string; external_id: string | null
    auth_method: string; totp_secret: string | null
  } | undefined
  if (!row) return null
  return {
    email: row.email,
    role: row.role,
    remove_default: isNoneRole(row.role),
    remove_blocked_reason: isLastLocalAdmin(db, row.id) ? LAST_LOCAL_ADMIN_ERROR : null,
    is_own: isOwnAccount(sessionUserId, row),
    is_local: row.auth_method === "local",
    mfa_enrolled: Boolean(row.totp_secret && row.totp_secret.length > 0),
  }
}
