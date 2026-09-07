// SPDX-License-Identifier: AGPL-3.0-only

/**
 * ADR-0015 `local:<id>` vs Entra oid convention: the Account's on-the-wire id
 * (session user id, push subscription uid, rate-limit key, `people.account_uid`
 * link value). One mint/parse seam so local vs Entra uids can't fork.
 */

/** Canonical local account uid: `local:<id>`. */
export function formatLocalAccountUid(localUserId: number): string {
  return `local:${localUserId}`
}

/** Numeric id from `local:<id>`; null for an Entra oid or any other non-local string. */
export function parseLocalAccountUid(uid: string | null | undefined): number | null {
  if (!uid || !uid.startsWith("local:")) return null
  const n = parseInt(uid.slice("local:".length), 10)
  return Number.isFinite(n) ? n : null
}

export interface AccountUidRow {
  auth_method: "local" | "entra"
  id: number
  external_id: string | null
}

/** `local:<id>` for a local account, the trimmed Entra `external_id` otherwise. */
export function accountUidFromRow(row: AccountUidRow): string | null {
  return row.auth_method === "local" ? formatLocalAccountUid(row.id) : (row.external_id?.trim() ?? null)
}
