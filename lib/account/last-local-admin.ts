// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"

/** Announced on the disabled control and returned by the API. */
export const LAST_LOCAL_ADMIN_ERROR = "Cannot remove the last local Admin"

/**
 * True when this Account is a local Admin and no other active local Admin exists.
 * Only an active Admin counts as another: a disabled one cannot sign in, so it would not stop a
 * lockout, and neither can a pending Invite. Entra Accounts are neither counted nor blocked.
 */
export function isLastLocalAdmin(db: Database.Database, accountId: number): boolean {
  const row = db
    .prepare("SELECT auth_method, role FROM accounts WHERE id = ?")
    .get(accountId) as { auth_method: string; role: string } | undefined
  if (!row || row.auth_method !== "local" || row.role !== "admin") return false
  const other = db
    .prepare(
      `SELECT id FROM accounts
       WHERE auth_method = 'local' AND role = 'admin' AND is_active = 1 AND status != 'invited' AND id != ?
       LIMIT 1`,
    )
    .get(accountId)
  return !other
}
