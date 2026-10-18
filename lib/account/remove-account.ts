// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { auditLog } from "@/lib/audit-log"
import { accountUidFromRow, type AccountUidRow } from "@/lib/account/account-uid"
import { isLastLocalAdmin, LAST_LOCAL_ADMIN_ERROR } from "@/lib/account/last-local-admin"
import { newRemovedAccountToken } from "@/lib/account/removed-account-label"
import { tombstoneEntraOid } from "@/lib/account/entra-removed"
import { actorRoleForLog, logDataEvent } from "@/lib/data-event-log"
import {
  ACCOUNT_STILL_LINKED_ERROR,
  CONFIRM_EMAIL_ERROR,
  DEMO_ACCOUNT_CHANGES_ERROR,
  OWN_ACCOUNT_ADMIN_ERROR,
  REMOVAL_WARNING,
  SELF_REAUTH_ERROR,
} from "@/lib/account/account-removal-messages"

export {
  ACCOUNT_STILL_LINKED_ERROR,
  CONFIRM_EMAIL_ERROR,
  DEMO_ACCOUNT_CHANGES_ERROR,
  OWN_ACCOUNT_ADMIN_ERROR,
  REMOVAL_WARNING,
  SELF_REAUTH_ERROR,
}

export interface AccountRemovalCounts {
  audit_rows: number
  record_rows: number
  push_subscriptions: number
  favourites: number
  settings: number
  notification_log: number
}

export interface AccountRemovalResult {
  counts: AccountRemovalCounts
}

interface AccountRow extends AccountUidRow {
  email: string
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

function createdByTables(db: Database.Database): string[] {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[]
  return tables
    .map(row => row.name)
    .filter(name => IDENTIFIER.test(name))
    .filter(name => {
      const columns = db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]
      return columns.some(column => column.name === "created_by")
    })
}

export function accountRemovalRewriteCounts(
  db: Database.Database,
  email: string,
): { audit_rows: number; record_rows: number } {
  const audit_rows = (
    db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE lower(user_email) = lower(?)").get(email) as { n: number }
  ).n
  let record_rows = 0
  for (const table of createdByTables(db)) {
    record_rows += (
      db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE lower(created_by) = lower(?)`).get(email) as { n: number }
    ).n
  }
  return { audit_rows, record_rows }
}

function countWhere(db: Database.Database, sql: string, value: string): number {
  return (db.prepare(sql).get(value) as { n: number }).n
}

/**
 * Permanently removes one Account. Refuses the last local Admin and an Account that is
 * still linked to a Person. One transaction. Does not delete Person rows.
 */
export function removeAccount(
  db: Database.Database,
  accountId: number,
  actorEmail: string | null,
  actorRole: string,
): AccountRemovalResult {
  const existing = db
    .prepare("SELECT id, email, auth_method, external_id FROM accounts WHERE id = ?")
    .get(accountId) as AccountRow | undefined
  if (!existing) {
    throw new AccountRemovalError("Not found", 404)
  }

  const counts = db.transaction(() => {
    if (isLastLocalAdmin(db, accountId)) {
      throw new AccountRemovalError(LAST_LOCAL_ADMIN_ERROR, 400)
    }
    const uid = accountUidFromRow(existing)
    if (uid) {
      const linked = db.prepare("SELECT id FROM people WHERE account_uid = ? LIMIT 1").get(uid)
      if (linked) throw new AccountRemovalError(ACCOUNT_STILL_LINKED_ERROR, 409)
    }

    const email = existing.email
    const token = newRemovedAccountToken()
    const rewrite = accountRemovalRewriteCounts(db, email)
    const push_subscriptions = uid
      ? countWhere(db, "SELECT COUNT(*) AS n FROM push_endpoints WHERE user_uid = ?", uid)
      : 0
    const favourites = uid
      ? countWhere(db, "SELECT COUNT(*) AS n FROM favourites WHERE user_uid = ?", uid)
      : 0
    const settings = uid
      ? countWhere(db, "SELECT COUNT(*) AS n FROM user_settings WHERE user_uid = ?", uid)
        + countWhere(db, "SELECT COUNT(*) AS n FROM user_app_state WHERE user_uid = ?", uid)
      : 0
    const notification_log = uid
      ? countWhere(db, "SELECT COUNT(*) AS n FROM notification_log WHERE recipient_user_id = ?", uid)
      : 0

    if (uid) {
      db.prepare("DELETE FROM push_endpoints WHERE user_uid = ?").run(uid)
      db.prepare("DELETE FROM favourites WHERE user_uid = ?").run(uid)
      db.prepare("DELETE FROM user_settings WHERE user_uid = ?").run(uid)
      db.prepare("DELETE FROM user_app_state WHERE user_uid = ?").run(uid)
      db.prepare("DELETE FROM person_notification_prefs WHERE user_uid = ?").run(uid)
      db.prepare("DELETE FROM notification_log WHERE recipient_user_id = ?").run(uid)
    }
    if (existing.auth_method === "entra" && existing.external_id) {
      db.prepare(
        "DELETE FROM auth_revalidation_status WHERE provider = 'entra' AND external_id = ?",
      ).run(existing.external_id)
      tombstoneEntraOid(db, existing.external_id, new Date().toISOString())
    }

    db.prepare("UPDATE audit_log SET user_email = ? WHERE lower(user_email) = lower(?)").run(token, email)
    for (const table of createdByTables(db)) {
      db.prepare(`UPDATE ${table} SET created_by = ? WHERE lower(created_by) = lower(?)`).run(token, email)
    }

    db.prepare("DELETE FROM accounts WHERE id = ?").run(accountId)

    const actorIsRemoved = actorEmail != null && actorEmail.trim().toLowerCase() === email.trim().toLowerCase()
    const recorded: AccountRemovalCounts = {
      audit_rows: rewrite.audit_rows,
      record_rows: rewrite.record_rows,
      push_subscriptions,
      favourites,
      settings,
      notification_log,
    }
    auditLog(db, actorIsRemoved ? token : actorEmail, "DELETE", "accounts", null, {
      event: "Account removed",
      counts: recorded,
    })
    return recorded
  })()

  logDataEvent({
    event: "account_removed",
    outcome: "removed",
    actorRole,
    counts: { ...counts },
  })

  return { counts }
}

export class AccountRemovalError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "AccountRemovalError"
  }
}
