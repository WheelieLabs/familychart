// SPDX-License-Identifier: AGPL-3.0-only

import { createHash } from "node:crypto"
import type Database from "better-sqlite3-multiple-ciphers"

/** SHA-256 of the Entra object id. The object id, email and name are not stored. */
export function entraOidHash(oid: string): string {
  return createHash("sha256").update(oid, "utf8").digest("hex")
}

function tombstoneTable(db: Database.Database): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'entra_removed_accounts'",
  ).get())
}

export function isEntraOidRemoved(db: Database.Database, oid: string): boolean {
  if (!tombstoneTable(db)) return false
  const row = db
    .prepare("SELECT 1 AS n FROM entra_removed_accounts WHERE oid_hash = ?")
    .get(entraOidHash(oid))
  return Boolean(row)
}

export function tombstoneEntraOid(db: Database.Database, oid: string, removedAt: string): void {
  db.prepare(
    `INSERT INTO entra_removed_accounts (oid_hash, removed_at)
     VALUES (?, ?)
     ON CONFLICT(oid_hash) DO UPDATE SET removed_at = excluded.removed_at`,
  ).run(entraOidHash(oid), removedAt)
}

export interface RemovedEntraAccount {
  id: string
  removed_at: string
}

export function listRemovedEntraAccounts(db: Database.Database): RemovedEntraAccount[] {
  return db
    .prepare("SELECT oid_hash AS id, removed_at FROM entra_removed_accounts ORDER BY removed_at DESC")
    .all() as RemovedEntraAccount[]
}

/** Clears one tombstone. Returns false when that hash is not stored. */
export function allowEntraPersonBack(db: Database.Database, oidHash: string): boolean {
  const info = db.prepare("DELETE FROM entra_removed_accounts WHERE oid_hash = ?").run(oidHash)
  return info.changes > 0
}
