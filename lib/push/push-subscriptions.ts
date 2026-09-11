// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { getAuthRevalidationStatus } from "../auth/auth-revalidation"
import type { AppUser } from "../session"
import { loadLocalUserSessionRow, localRoleToGroups } from "../local-user-session"
import { canReadForPerson } from "../permissions"
import { parseLocalAccountUid } from "../account/account-uid"

/** Remove all push endpoints and notification prefs for the given account uids. */
export function prunePushSubscriptionsForUserUids(
  db: Database.Database,
  userUids: string[],
): void {
  const uids = [...new Set(userUids.map(u => u.trim()).filter(Boolean))]
  if (uids.length === 0) return

  const placeholders = uids.map(() => "?").join(", ")
  db.prepare(`DELETE FROM person_notification_prefs WHERE user_uid IN (${placeholders})`).run(...uids)
  db.prepare(`DELETE FROM push_endpoints WHERE user_uid IN (${placeholders})`).run(...uids)
}

/**
 * True when `userUid` still has read access to `personId` at cron send time.
 * Local accounts are re-checked against live role/`is_active`. Entra OIDs consult
 * `auth_revalidation_status`: `revoked` always denies; when `groups_json` is set,
 * access follows `canReadForPerson` (including personal-link). Pre-first-poll
 * (`groups_json` null, status ok) fail-opens so login-time subscriptions keep
 * working until the hourly Graph poll lands.
 */
export function pushSubscriberStillAuthorised(
  db: Database.Database,
  userUid: string,
  personId: number,
): boolean {
  const person = db
    .prepare("SELECT account_uid FROM people WHERE id = ? AND is_active = 1")
    .get(personId) as { account_uid: string | null } | undefined
  if (!person) return false

  const uid = userUid.trim()
  const localId = parseLocalAccountUid(uid)
  if (localId != null) {
    const row = loadLocalUserSessionRow(db, localId)
    if (!row || !row.is_active) return false
    const sessionUser = { id: uid } as AppUser
    return canReadForPerson(localRoleToGroups(row.role, row.can_report), sessionUser, person.account_uid)
  }

  // Entra (or other non-local) UID — typically directory OID.
  const reval = getAuthRevalidationStatus(db, "entra", uid)
  if (reval?.status === "revoked") return false
  if (reval?.groups != null) {
    const sessionUser = { id: uid, entraOid: uid } as AppUser
    return canReadForPerson(reval.groups, sessionUser, person.account_uid)
  }
  return true
}
