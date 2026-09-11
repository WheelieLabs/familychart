// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { auditLog } from "@/lib/audit-log"
import { claimInviteForEntra, type EntraProfile } from "@/lib/invite"

export type { EntraProfile }

interface ExistingAccountRow {
  id: number
}

/**
 * Matches or creates an `accounts` row for an Entra sign-in: tries an Invite claim first
 * (lib/invite.ts's `claimInviteForEntra`), then falls through to dedup-by-`external_id`,
 * dedup-by-active-email, or auto-create. `lib/auth.ts` calls only this single entry point, so
 * it never learns claim-vs-create ordering.
 *
 * This is bookkeeping only — Entra access is governed entirely by group membership
 * (`isAdmin`/`resolveEntraJwtGroups`), never by `accounts.role`. The row exists purely so
 * the account can be manually linked to a Person and shows up in the admin accounts list.
 * `role` on an auto-created row is an inert 'read' default — never sourced from here.
 *
 * If the email instead belongs to an already-*active* row (e.g. a local admin whose Entra
 * UPN happens to match their local email), that row is left untouched and its id is simply
 * returned — not claimed, not duplicated, and not thrown on every sign-in.
 */
export function matchOrCreateEntraAccount(
  db: Database.Database,
  profile: EntraProfile,
): { accountId: number } {
  const email = profile.email?.trim().toLowerCase() || null

  const claim = claimInviteForEntra(db, profile)
  if (claim.claimed) {
    auditLog(db, email, "UPDATE", "accounts", claim.accountId, { invite_claimed_via_entra: true })
    return { accountId: claim.accountId }
  }

  const existing = db
    .prepare("SELECT id FROM accounts WHERE external_id = ?")
    .get(profile.oid) as ExistingAccountRow | undefined
  if (existing) return { accountId: existing.id }

  // An already-active row (local or a different Entra identity) can hold this same email —
  // e.g. a local admin whose Entra UPN happens to match their local email. `accounts.email`
  // is UNIQUE, so inserting below would throw every single sign-in with no path to recovery.
  // Report the existing row's id and leave it untouched (same never-touch-active invariant
  // as the invited-only claim above) instead of a steady-state per-login error-log throw.
  if (email) {
    const activeByEmail = db
      .prepare("SELECT id FROM accounts WHERE lower(email) = ?")
      .get(email) as ExistingAccountRow | undefined
    if (activeByEmail) return { accountId: activeByEmail.id }
  }

  const result = db
    .prepare(
      `INSERT INTO accounts (email, auth_method, external_id, status, role)
       VALUES (?, 'entra', ?, 'active', 'read')`,
    )
    .run(email ?? `entra:${profile.oid}`, profile.oid)
  return { accountId: Number(result.lastInsertRowid) }
}
