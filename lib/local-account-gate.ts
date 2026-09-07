// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"

/**
 * "Real local account" predicates, shared by every bootstrap/first-admin gate
 * (lib/setup-gate.ts, lib/setup-bootstrap.ts, lib/create-managed-admin.ts).
 *
 * `accounts` also holds a bookkeeping row auto-created for every Entra sign-in
 * (lib/account-entra-match.ts), regardless of whether that signer is an admin — so any of
 * these gates counting every row, or matching by email/role without `auth_method = 'local'`,
 * would treat a passive Entra sign-in as "an admin/account already exists" and permanently
 * lock out first-admin bootstrap or misreport setup as complete. One shared predicate here,
 * rather than three copies, so a fix to it can't be applied to two files and missed on a third.
 */

export function hasAnyLocalAccount(db: Database.Database): boolean {
  return !!db.prepare("SELECT id FROM accounts WHERE auth_method = 'local' LIMIT 1").get()
}

export function hasLocalAdminAccount(db: Database.Database): boolean {
  return !!db
    .prepare("SELECT id FROM accounts WHERE auth_method = 'local' AND role = 'admin' LIMIT 1")
    .get()
}

interface LocalAccountByEmailRow {
  id: number
  email: string
  must_reset_password: number
}

/** Case-insensitive: lib/account-entra-match.ts always lowercases the email it stores, and
 * accounts.email has no COLLATE NOCASE, so an exact-match lookup here would miss a row whose
 * email was typed or seeded with different casing than the value being looked up. */
export function findLocalAccountByEmail(
  db: Database.Database,
  email: string,
): LocalAccountByEmailRow | undefined {
  return db
    .prepare("SELECT id, email, must_reset_password FROM accounts WHERE auth_method = 'local' AND lower(email) = lower(?)")
    .get(email) as LocalAccountByEmailRow | undefined
}

/** Case-insensitive: see findLocalAccountByEmail. True when *any* account (any auth_method)
 * already occupies this exact email — accounts.email is globally UNIQUE, so this is the
 * pre-check that turns what would otherwise be a raw constraint-violation throw into a
 * clean, handled failure. */
export function isEmailTakenByAnyAccount(db: Database.Database, email: string): boolean {
  return !!db.prepare("SELECT id FROM accounts WHERE lower(email) = lower(?)").get(email)
}
