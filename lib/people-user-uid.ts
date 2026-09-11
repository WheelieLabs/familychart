// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import type { Person } from "./domain-types"

export const PEOPLE_ACCOUNT_UID_UNIQUE_INDEX = "idx_people_account_uid_unique"

export const ACCOUNT_UID_ALREADY_LINKED_ERROR =
  "This account is already linked to another family member"

/** Normalise API/form input: trim; empty → null. */
export function normalizePersonAccountUid(raw: unknown): string | null {
  if (raw == null) return null
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  return trimmed === "" ? null : trimmed
}

export function hasPeopleAccountUidUniqueIndex(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(PEOPLE_ACCOUNT_UID_UNIQUE_INDEX)
  return row != null
}

/** Clear duplicate links, keeping the lowest person id per account_uid. */
export function reconcileDuplicatePeopleAccountUids(db: Database.Database): {
  cleared: { personId: number; accountUid: string; keptPersonId: number }[]
} {
  const groups = db
    .prepare(
      `SELECT account_uid, MIN(id) AS keep_id, COUNT(*) AS cnt
       FROM people
       WHERE account_uid IS NOT NULL AND TRIM(account_uid) != ''
       GROUP BY account_uid
       HAVING cnt > 1`,
    )
    .all() as { account_uid: string; keep_id: number; cnt: number }[]

  const cleared: { personId: number; accountUid: string; keptPersonId: number }[] = []
  const clearStmt = db.prepare(
    "UPDATE people SET account_uid = NULL WHERE account_uid = ? AND id != ?",
  )

  for (const group of groups) {
    const dupes = db
      .prepare("SELECT id FROM people WHERE account_uid = ? AND id != ?")
      .all(group.account_uid, group.keep_id) as { id: number }[]
    clearStmt.run(group.account_uid, group.keep_id)
    for (const dupe of dupes) {
      cleared.push({
        personId: dupe.id,
        accountUid: group.account_uid,
        keptPersonId: group.keep_id,
      })
    }
  }

  return { cleared }
}

export function ensurePeopleAccountUidUniqueIndex(db: Database.Database): void {
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS ${PEOPLE_ACCOUNT_UID_UNIQUE_INDEX}
     ON people(account_uid) WHERE account_uid IS NOT NULL`,
  )
}

export function migratePeopleAccountUidUnique(db: Database.Database): {
  reconciled: ReturnType<typeof reconcileDuplicatePeopleAccountUids>
} {
  const reconciled = reconcileDuplicatePeopleAccountUids(db)
  ensurePeopleAccountUidUniqueIndex(db)
  return { reconciled }
}

/** Active person (any is_active) already using this uid, excluding optional person id. */
export function findPersonAccountUidConflict(
  db: Database.Database,
  accountUid: string | null,
  excludePersonId?: number,
): Person | undefined {
  if (accountUid == null) return undefined
  if (excludePersonId != null) {
    return db
      .prepare(
        `SELECT * FROM people
         WHERE account_uid = ? AND id != ? AND is_active = 1
         LIMIT 1`,
      )
      .get(accountUid, excludePersonId) as Person | undefined
  }
  return db
    .prepare(
      `SELECT * FROM people WHERE account_uid = ? AND is_active = 1 LIMIT 1`,
    )
    .get(accountUid) as Person | undefined
}

export function isPeopleAccountUidConstraintError(err: unknown): boolean {
  return (
    err != null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
  )
}
