// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { formatLocalAccountUid, parseLocalAccountUid } from "@/lib/account/account-uid"

/** Stored sentinel for a local Account with no household Role. Not a ladder rung. */
export const NONE_ROLE = "none"

export function isNoneRole(role: string | null | undefined): boolean {
  return role === NONE_ROLE
}

export const NONE_ROLE_INVITE_ERROR = "A Personal-link is required when Role is None"
export const NONE_ROLE_EDIT_ERROR =
  "A Personal-link is required when Role is None. Link this Account under Management → People, then set Role to None."
export const NONE_ROLE_UNLINK_ERROR =
  "Cannot clear the Personal-link while this Account's Role is None"

/** Role None never keeps Household Reports. Other roles pass the requested flag through. */
export function householdReportsForRole(
  role: string,
  requested: number | undefined,
): number | undefined {
  return isNoneRole(role) ? 0 : requested
}

export function localAccountHasPersonalLink(db: Database.Database, accountId: number): boolean {
  const personalLink = db
    .prepare("SELECT id FROM people WHERE is_active = 1 AND account_uid = ? LIMIT 1")
    .get(formatLocalAccountUid(accountId))
  return personalLink != null
}

/** True when this save would clear `people.account_uid` on a Role None Account. Relinks are allowed. */
export function isClearingNoneRolePersonalLink(
  db: Database.Database,
  existingAccountUid: string | null,
  nextAccountUid: string | null,
): boolean {
  if (!existingAccountUid || nextAccountUid != null) return false
  const linkedAccountId = parseLocalAccountUid(existingAccountUid)
  if (linkedAccountId == null) return false
  const linkedAccount = db
    .prepare("SELECT role FROM accounts WHERE id = ?")
    .get(linkedAccountId) as { role: string } | undefined
  return isNoneRole(linkedAccount?.role)
}
