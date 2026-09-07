// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"

/** Bump session_version so existing JWTs for this user are rejected on the next request. */
export function bumpLocalUserSessionVersion(db: Database.Database, localUserId: number): void {
  db.prepare(
    "UPDATE accounts SET session_version = COALESCE(session_version, 0) + 1 WHERE id = ?",
  ).run(localUserId)
}

export function localRoleToGroups(role: string, canReport: number): string[] {
  const groups: string[] = []
  if (role === "admin") groups.push("local:admin")
  else if (role === "manage") groups.push("local:manage")
  else if (role === "write") groups.push("local:write")
  else if (role === "read") groups.push("local:read")
  if (canReport) groups.push("local:report")
  return groups
}

export interface LocalUserSessionRow {
  role: string
  can_report: number
  is_active: number
  session_version: number
}

export function loadLocalUserSessionRow(
  db: Database.Database,
  localUserId: number,
): LocalUserSessionRow | undefined {
  return db
    .prepare(
      "SELECT role, can_report, is_active, session_version FROM accounts WHERE id = ?",
    )
    .get(localUserId) as LocalUserSessionRow | undefined
}

/**
 * Returns null when the local session should be revoked (inactive or stale session_version).
 */
export function refreshLocalUserSession(
  db: Database.Database,
  localUserId: number,
  tokenSessionVersion: number | undefined,
): { groups: string[]; sessionVersion: number } | null {
  const row = loadLocalUserSessionRow(db, localUserId)
  if (!row || !row.is_active) return null
  const version = row.session_version ?? 0
  if (tokenSessionVersion !== undefined && tokenSessionVersion !== version) return null
  return {
    groups: localRoleToGroups(row.role, row.can_report),
    sessionVersion: version,
  }
}
