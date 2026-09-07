// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { auditLog } from "@/lib/audit-log"

export type WriteUserSettingOptions = {
  userUid: string
  key: string
  /** Pass `null` to delete the key. */
  value: string | null
  actorEmail?: string | null
  /**
   * When not `false`, write an `audit_log` row for user-initiated changes.
   * Pass `false` for system bookkeeping (e.g. hydration last_nudge_at / last_record_at).
   */
  audit?: boolean
}

/** Actor/audit options for domain setters that call writeUserSetting. */
export type UserSettingWriteOpts = Pick<WriteUserSettingOptions, "actorEmail" | "audit">

/**
 * Shared user_settings write gate with optional audit trail.
 * Mirrors upsertAppSetting() for per-user keys.
 */
export function writeUserSetting(db: Database.Database, options: WriteUserSettingOptions): void {
  const userUid = options.userUid.trim()
  if (userUid === "") throw new Error("userUid is required")

  const key = options.key.trim()
  if (key === "") throw new Error("key is required")

  const shouldAudit = options.audit !== false
  const oldRow = db
    .prepare("SELECT value FROM user_settings WHERE user_uid = ? AND key = ?")
    .get(userUid, key) as { value: string } | undefined
  const old_value = oldRow?.value ?? null

  if (options.value === null) {
    if (oldRow) {
      db.prepare("DELETE FROM user_settings WHERE user_uid = ? AND key = ?").run(userUid, key)
      if (shouldAudit) {
        auditLog(db, options.actorEmail, "UPDATE", "user_settings", null, {
          user_uid: userUid,
          key,
          old_value,
          new_value: null,
          removed: true,
        })
      }
    }
    return
  }

  const new_value = options.value
  db.prepare(
    `INSERT INTO user_settings (user_uid, key, value, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_uid, key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
  ).run(userUid, key, new_value, Date.now())

  if (shouldAudit && old_value !== new_value) {
    auditLog(db, options.actorEmail, "UPDATE", "user_settings", null, {
      user_uid: userUid,
      key,
      old_value,
      new_value,
    })
  }
}
