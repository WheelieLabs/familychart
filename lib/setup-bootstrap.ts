// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { isAdminSeen, isSetupComplete } from "@/lib/setup-gate"
import { hasAnyLocalAccount, isEmailTakenByAnyAccount } from "@/lib/local-account-gate"

/** True when the self-host bootstrap endpoint may create the first local admin. */
export function isBootstrapEndpointAllowed(): boolean {
  if (process.env.FC_PLATFORM_PROFILE === "managed") return false
  return true
}

export type CreateFirstAdminResult =
  | { status: 201 }
  | { status: 403; error: string }
  | { status: 409; error: string }

/**
 * Creates the first local admin, gated against every way the bootstrap window can already be
 * closed: setup complete, an admin has been seen (Entra-primary instances), or any local user
 * exists. Runs as a single `BEGIN IMMEDIATE` transaction so two concurrent unauthenticated
 * POSTs cannot both pass the empty-table check and create two admins.
 */
export function createFirstAdmin(
  db: Database.Database,
  email: string,
  passwordHash: string,
): CreateFirstAdminResult {
  return db.transaction((): CreateFirstAdminResult => {
    if (isSetupComplete(db)) {
      return { status: 403, error: "Setup already complete" }
    }
    if (isAdminSeen(db)) {
      return { status: 403, error: "An administrator already exists" }
    }
    if (hasAnyLocalAccount(db)) {
      return { status: 403, error: "Local accounts already exist" }
    }
    // Not scoped to auth_method = 'local': an Entra bookkeeping row with this email would
    // otherwise throw an unhandled accounts.email UNIQUE-constraint error on the INSERT below.
    if (isEmailTakenByAnyAccount(db, email)) {
      return { status: 409, error: "Email already exists" }
    }
    db.prepare(
      "INSERT INTO accounts (email, password_hash, role, can_report) VALUES (?, ?, 'admin', 0)",
    ).run(email, passwordHash)
    return { status: 201 }
  }).immediate()
}
