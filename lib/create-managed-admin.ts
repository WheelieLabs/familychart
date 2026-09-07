// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { findLocalAccountByEmail, hasAnyLocalAccount, isEmailTakenByAnyAccount } from "@/lib/local-account-gate"

export type EnsureManagedAdminResult =
  | { ok: true; userId: number; created: boolean; mustResetPassword: boolean }
  | { ok: false; error: string }

/**
 * Ensure the pre-seeded managed admin row exists. Idempotent for the same email:
 * a second call does not duplicate the row or change the password hash.
 * Refuses if a different local account already exists — this path is only for
 * the empty-tenant first admin.
 */
export function ensureManagedAdmin(
  db: Database.Database,
  email: string,
  passwordHash: string,
): EnsureManagedAdminResult {
  const trimmed = typeof email === "string" ? email.trim() : ""
  if (!trimmed) return { ok: false, error: "email is required" }
  if (!passwordHash) return { ok: false, error: "passwordHash is required" }

  return db
    .transaction((): EnsureManagedAdminResult => {
      // Scoped to auth_method = 'local': an Entra bookkeeping row auto-created for a passive
      // sign-in matching this email (lib/account-entra-match.ts) must never be mistaken for
      // the already-seeded managed admin — that would report ok:true/created:false without
      // ever creating the real admin credential.
      const existing = findLocalAccountByEmail(db, trimmed)

      if (existing) {
        return {
          ok: true,
          userId: existing.id,
          created: false,
          mustResetPassword: existing.must_reset_password === 1,
        }
      }

      if (hasAnyLocalAccount(db)) {
        return { ok: false, error: "A local account already exists with a different email" }
      }

      // Not scoped to auth_method = 'local': accounts.email is globally UNIQUE, so an Entra
      // bookkeeping row that happens to share this exact email would otherwise make the
      // INSERT below throw a raw, unhandled constraint error instead of a clean failure.
      if (isEmailTakenByAnyAccount(db, trimmed)) {
        return { ok: false, error: "This email is already in use by a different account" }
      }

      const result = db
        .prepare(
          "INSERT INTO accounts (email, password_hash, role, can_report, must_reset_password) VALUES (?, ?, 'admin', 0, 1)",
        )
        .run(trimmed, passwordHash)

      return {
        ok: true,
        userId: Number(result.lastInsertRowid),
        created: true,
        mustResetPassword: true,
      }
    })
    .immediate()
}
