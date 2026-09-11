// SPDX-License-Identifier: AGPL-3.0-only

import crypto from "node:crypto"
import type Database from "better-sqlite3-multiple-ciphers"
import { formatLocalAccountUid, parseLocalAccountUid } from "@/lib/account/account-uid"
import { isEmailTakenByAnyAccount } from "@/lib/local-account-gate"
import { isPeopleAccountUidConstraintError } from "@/lib/people-user-uid"
import type { Account, Person } from "@/lib/domain-types"
import type { AppUser } from "@/lib/session"
import { inviteEmailHtml, inviterSentenceParts, type InviterDisplay } from "@/lib/email-templates"

/** Fixed invite window, per spec — not admin-configurable. Staleness is handled by resend. */
const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Random opaque invite token, plus the hash stored in `accounts.invite_token_hash`. Internal
 * to this module — no other module should mint an invite token.
 *
 * Deliberately not HMAC/HKDF-based like `reset-token.ts`: that scheme exists because reset
 * tokens are minted by a *different service* (familychart-admin) with no DB access. Invite
 * tokens are minted in-app with full DB access, so verification is a plain hash lookup —
 * tying invite validity to `NEXTAUTH_SECRET` would buy nothing and would silently invalidate
 * every pending invite on a secret rotation. See ADR-0015 vs ADR-0014.
 */
function hashInviteToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex")
}

function generateInviteToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString("base64url")
  return { token, tokenHash: hashInviteToken(token) }
}

/**
 * Resolves how to identify the inviting admin in invite-email copy.
 * Priority order: their Personal-linked Person's name, else their Entra profile name
 * (local sign-in never has one — see `lib/auth.ts`'s `jwt` callback, which only sets
 * `token.name` inside the Entra `profile` branch), else their account email as a last
 * resort. `inviter.id` is the admin's account uid (`local:<id>` or Entra oid) — the same
 * value stored in `people.account_uid` for a Personal-link, per ADR-0015.
 */
export function resolveInviterDisplay(db: Database.Database, inviter: AppUser): InviterDisplay {
  if (inviter.id) {
    const person = db
      .prepare("SELECT name FROM people WHERE account_uid = ? AND is_active = 1")
      .get(inviter.id) as { name: string } | undefined
    if (person?.name) return { kind: "name", value: person.name }
  }
  if (inviter.entraOid && inviter.name) return { kind: "name", value: inviter.name }
  return { kind: "email", value: inviter.email ?? "" }
}

/** Shared invite-email content for create, resend, and Entra claim's local-path sibling. */
function buildInviteEmail(
  origin: string,
  token: string,
  inviter: InviterDisplay,
): { subject: string; text: string; html: string } {
  const acceptUrl = `${origin}/accept-invite#token=${token}`
  const { prefix, value, suffix } = inviterSentenceParts(inviter)
  const bodySentence = `${prefix}${value}${suffix}`

  return {
    subject: "You've been invited to FamilyChart",
    text: `You're invited to FamilyChart\n\n${bodySentence} Set a password to get started:\n\n${acceptUrl}\n\nThis link expires in 7 days and can only be used once.`,
    html: inviteEmailHtml({ inviter, acceptUrl }),
  }
}

interface InviteLifecycleFields {
  status: string
  invite_expires_at: string | null
  invite_revoked_at: string | null
}

/**
 * Single encoding of Invite liveness (see CONTEXT.md "Invite"): the one place `linkable`
 * (list and create), the dead-Invite link guard, and display status all read from, so they
 * cannot diverge the way three separate encodings could before this module existed.
 */
function isInviteLive(row: InviteLifecycleFields, nowMs: number): boolean {
  if (row.status !== "invited") return false
  if (row.invite_revoked_at != null) return false
  if (row.invite_expires_at == null) return false
  return new Date(row.invite_expires_at).getTime() > nowMs
}

export type AccountInviteDisplayStatus = "active" | "invited" | "expired" | "revoked"

export function accountInviteDisplayStatus(
  row: InviteLifecycleFields,
  nowMs: number = Date.now(),
): AccountInviteDisplayStatus {
  if (row.status !== "invited") return "active"
  if (row.invite_revoked_at != null) return "revoked"
  return isInviteLive(row, nowMs) ? "invited" : "expired"
}

export const DEAD_INVITE_LINK_ERROR = "This invite has expired or been revoked and can't be linked"

/**
 * True when `accountUid` points at a local `accounts` row that's a dead invite — still
 * `status = 'invited'` but expired or revoked, never accepted. A live invite or any
 * already-active account (local or Entra) is never "dead" here. Enforced server-side so a
 * dead invite can't be offered as a link target even if a client bypasses the UI.
 */
export function isDeadInviteAccountUid(
  db: Database.Database,
  accountUid: string | null,
  nowMs: number = Date.now(),
): boolean {
  const id = parseLocalAccountUid(accountUid)
  if (id == null) return false
  const row = db
    .prepare("SELECT status, invite_revoked_at, invite_expires_at FROM accounts WHERE id = ?")
    .get(id) as InviteLifecycleFields | undefined
  if (!row || row.status !== "invited") return false
  return !isInviteLive(row, nowMs)
}

export type AdminInviteRow = Pick<
  Account,
  | "id"
  | "email"
  | "role"
  | "can_report"
  | "is_active"
  | "auth_method"
  | "external_id"
  | "status"
  | "invite_expires_at"
  | "invite_revoked_at"
  | "created_at"
> & { mfa_enrolled: number; linkable: number }

/**
 * Every Account, with `linkable` (0/1, for the manual Personal-link dropdown) computed via
 * `isInviteLive` — active Accounts are always linkable; a pending Invite is linkable only
 * while live.
 */
export function listInvitesForAdmin(db: Database.Database, nowMs: number = Date.now()): AdminInviteRow[] {
  const rows = db
    .prepare(
      `SELECT id, email, role, can_report, is_active, auth_method, external_id, status,
         invite_expires_at, invite_revoked_at, created_at,
         CASE WHEN totp_secret IS NOT NULL AND totp_secret != '' THEN 1 ELSE 0 END AS mfa_enrolled
       FROM accounts ORDER BY email`,
    )
    .all() as Omit<AdminInviteRow, "linkable">[]
  return rows.map(row => ({
    ...row,
    linkable: row.status !== "invited" || isInviteLive(row, nowMs) ? 1 : 0,
  }))
}

export interface CreateInviteInput {
  email: string
  role: string
  personAction: "link" | "create" | "none"
  personId?: number
  personName?: string
}

export type CreatedInviteAccount = Pick<
  Account,
  "id" | "email" | "role" | "can_report" | "is_active" | "auth_method" | "status" | "invite_expires_at" | "created_at"
>

export type CreateInviteResult =
  | {
      ok: true
      account: CreatedInviteAccount
      token: string
      mail: { to: string; subject: string; text: string; html: string }
    }
  | { ok: false; reason: "email_taken" | "person_not_found" | "person_already_linked" }

/** Thrown inside the create-invite transaction when the person-link re-check fails; rolls
 * back the transaction (including the just-inserted account row). */
class PersonAlreadyLinkedError extends Error {}

/**
 * Mints and inserts an `invited` Account, with an optional Personal-link or Person create, in
 * one transaction — a failed Personal-link never leaves an orphan invited Account. Does not send
 * mail or write the audit log; the caller (HTTP route) owns both, using the returned `mail`
 * fields and `account.id`.
 */
export function createInvite(
  db: Database.Database,
  input: CreateInviteInput,
  { origin, inviter, nowMs = Date.now() }: { origin: string; inviter: AppUser; nowMs?: number },
): CreateInviteResult {
  const { email, role, personAction, personId, personName } = input

  if (isEmailTakenByAnyAccount(db, email)) {
    return { ok: false, reason: "email_taken" }
  }

  let linkPerson: Person | undefined
  if (personAction === "link") {
    linkPerson = db
      .prepare("SELECT * FROM people WHERE id = ? AND is_active = 1")
      .get(personId) as Person | undefined
    if (!linkPerson) return { ok: false, reason: "person_not_found" }
    if (linkPerson.account_uid != null) return { ok: false, reason: "person_already_linked" }
  }

  const { token, tokenHash } = generateInviteToken()
  const inviteExpiresAt = new Date(nowMs + INVITE_EXPIRY_MS).toISOString()

  let accountId: number
  try {
    accountId = db
      .transaction((): number => {
        const result = db
          .prepare(
            `INSERT INTO accounts (email, role, status, auth_method, invite_token_hash, invite_expires_at)
             VALUES (?, ?, 'invited', 'local', ?, ?)`,
          )
          .run(email, role, tokenHash, inviteExpiresAt)
        const newId = Number(result.lastInsertRowid)
        // Freshly minted `local:<newId>` can never already be in use — no pre-check needed;
        // the partial unique index on people.account_uid is the real guard (caught below).
        const accountUid = formatLocalAccountUid(newId)

        if (personAction === "link" && linkPerson) {
          // Re-check inside the transaction: the pre-check above ran before this transaction
          // started, and the partial unique index on people.account_uid only guards against
          // reusing the same account_uid twice — it does nothing to stop this UPDATE from
          // silently overwriting a different account_uid that got linked to this same person
          // in between. `changes === 0` means someone else linked this person first.
          const updated = db
            .prepare("UPDATE people SET account_uid = ? WHERE id = ? AND account_uid IS NULL")
            .run(accountUid, linkPerson.id)
          if (updated.changes === 0) throw new PersonAlreadyLinkedError()
        } else if (personAction === "create") {
          db.prepare("INSERT INTO people (name, account_uid) VALUES (?, ?)").run(personName, accountUid)
        }

        return newId
      })
      .immediate()
  } catch (err) {
    if (err instanceof PersonAlreadyLinkedError) {
      return { ok: false, reason: "person_already_linked" }
    }
    if (isPeopleAccountUidConstraintError(err)) {
      // Same SQLITE_CONSTRAINT_UNIQUE code covers both accounts.email (a same-email invite
      // racing the pre-check above) and the people.account_uid partial unique index — the
      // message is the only way to tell which one actually fired.
      const message = err instanceof Error ? err.message : ""
      if (message.includes("people.account_uid")) return { ok: false, reason: "person_already_linked" }
      return { ok: false, reason: "email_taken" }
    }
    throw err
  }

  const account = db
    .prepare(
      "SELECT id, email, role, can_report, is_active, auth_method, status, invite_expires_at, created_at FROM accounts WHERE id = ?",
    )
    .get(accountId) as CreatedInviteAccount

  const inviterDisplay = resolveInviterDisplay(db, inviter)
  return { ok: true, account, token, mail: { to: email, ...buildInviteEmail(origin, token, inviterDisplay) } }
}

export interface InviteResendDraft {
  accountId: number
  email: string
  tokenHash: string
  inviteExpiresAt: string
  mail: { to: string; subject: string; text: string; html: string }
}

export type PrepareInviteResendResult =
  | { ok: true; draft: InviteResendDraft }
  | { ok: false; reason: "not_pending" }

/**
 * Mints a fresh token and mail draft for a pending Invite, without persisting anything.
 * Two-phase with `commitInviteResend` so the caller can send mail with the new token
 * *before* persisting it — the old token may still be live, so a delivery failure here must
 * not strand the invitee with neither a working old link nor a delivered new one.
 */
export function prepareInviteResend(
  db: Database.Database,
  accountId: number,
  { origin, inviter, nowMs = Date.now() }: { origin: string; inviter: AppUser; nowMs?: number },
): PrepareInviteResendResult {
  const account = db
    .prepare("SELECT id, email FROM accounts WHERE id = ? AND status = 'invited'")
    .get(accountId) as { id: number; email: string } | undefined
  if (!account) return { ok: false, reason: "not_pending" }

  const { token, tokenHash } = generateInviteToken()
  const inviteExpiresAt = new Date(nowMs + INVITE_EXPIRY_MS).toISOString()
  const inviterDisplay = resolveInviterDisplay(db, inviter)

  return {
    ok: true,
    draft: {
      accountId: account.id,
      email: account.email,
      tokenHash,
      inviteExpiresAt,
      mail: { to: account.email, ...buildInviteEmail(origin, token, inviterDisplay) },
    },
  }
}

/**
 * Persists a resend draft: new token hash, extended expiry, and clears `invite_revoked_at` —
 * identical whether the invite was previously expired or explicitly revoked. Never touches
 * role or `people.account_uid`. Call only after mail from `prepareInviteResend` sent
 * successfully.
 */
export function commitInviteResend(db: Database.Database, draft: InviteResendDraft): void {
  db.prepare(
    `UPDATE accounts SET invite_token_hash = ?, invite_expires_at = ?, invite_revoked_at = NULL
     WHERE id = ? AND status = 'invited'`,
  ).run(draft.tokenHash, draft.inviteExpiresAt, draft.accountId)
}

/**
 * Revoke a pending invite: sets `invite_revoked_at`, never touches role or
 * `people.account_uid` (resend is designed to "just work" on the same row, so nothing about
 * the invite's original role/person-link decision is unwound here). Returns false when there
 * was no live-or-dead pending invite to revoke (already active, or already revoked).
 */
export function revokeInvite(db: Database.Database, accountId: number, nowMs: number = Date.now()): boolean {
  const updated = db
    .prepare(
      `UPDATE accounts SET invite_revoked_at = ?
       WHERE id = ? AND status = 'invited' AND invite_revoked_at IS NULL`,
    )
    .run(new Date(nowMs).toISOString(), accountId)
  return updated.changes > 0
}

export type VerifyInviteTokenResult = { valid: true; accountId: number } | { valid: false }

/** Verify an invite token: hash lookup, still `invited`, not revoked, not expired. */
export function verifyInviteToken(
  db: Database.Database,
  token: string,
  nowMs: number = Date.now(),
): VerifyInviteTokenResult {
  if (!token) return { valid: false }
  const tokenHash = hashInviteToken(token)
  const row = db
    .prepare(
      `SELECT id FROM accounts
       WHERE invite_token_hash = ?
         AND status = 'invited'
         AND invite_revoked_at IS NULL
         AND invite_expires_at > ?`,
    )
    .get(tokenHash, new Date(nowMs).toISOString()) as { id: number } | undefined
  if (!row) return { valid: false }
  return { valid: true, accountId: row.id }
}

export type RedeemInviteResult = { ok: true; accountId: number; email: string } | { ok: false }

/**
 * Verify an invite token and, if valid, atomically materialize the account: set the password
 * hash, flip `status` to `active`, and clear the token/expiry so it can't be redeemed again.
 * `invite_revoked_at` is left untouched — redemption already implies it was null.
 */
export function redeemInvite(
  db: Database.Database,
  token: string,
  passwordHash: string,
  nowMs: number = Date.now(),
): RedeemInviteResult {
  return db
    .transaction((): RedeemInviteResult => {
      const result = verifyInviteToken(db, token, nowMs)
      if (!result.valid) return { ok: false }

      const updated = db
        .prepare(
          `UPDATE accounts
           SET password_hash = ?, status = 'active', invite_token_hash = NULL, invite_expires_at = NULL
           WHERE id = ? AND status = 'invited'`,
        )
        .run(passwordHash, result.accountId)
      if (updated.changes === 0) return { ok: false }

      const row = db.prepare("SELECT email FROM accounts WHERE id = ?").get(result.accountId) as
        | { email: string }
        | undefined
      if (!row) return { ok: false }

      return { ok: true, accountId: result.accountId, email: row.email }
    })
    .immediate()
}

export interface EntraProfile {
  oid: string
  email: string | null | undefined
}

export type ClaimInviteForEntraResult = { claimed: true; accountId: number } | { claimed: false }

/**
 * Claims a pending Invite for an Entra sign-in: matches by email against any `invited`-status
 * row — live *or* dead (expired or revoked) — never an already-`active` one, so this can
 * never repoint or take over an existing local/Entra account. Dead invites still occupy
 * `accounts.email` (UNIQUE), so they must be eligible here too, or the caller's auto-create
 * fallback would throw on a duplicate email the first time someone whose local invite lapsed
 * instead signs in via Entra. An "Account only" invite is handled identically to a
 * Personal-linked one — no special-casing needed.
 *
 * A Personal-link set at invite time (`personAction: 'link'/'create'`) has
 * `people.account_uid = 'local:<id>'`, set under the assumption the invitee would accept via
 * the local-password path. Claiming via Entra instead changes what that accounts row *is* —
 * its session identity becomes the raw oid (`lib/auth.ts` sets `token.sub = p.oid` for Entra
 * sessions), not `'local:<id>'` — so the link is repointed here or the Person's
 * personal-link access breaks silently and permanently.
 *
 * Does not write the audit log — the caller (the Entra Account orchestrator) owns that, since
 * it also owns the auto-create path this sits beside.
 */
export function claimInviteForEntra(db: Database.Database, profile: EntraProfile): ClaimInviteForEntraResult {
  const email = profile.email?.trim().toLowerCase() || null
  if (!email) return { claimed: false }

  const invited = db
    .prepare(`SELECT id FROM accounts WHERE status = 'invited' AND lower(email) = ?`)
    .get(email) as { id: number } | undefined
  if (!invited) return { claimed: false }

  const claimed = db
    .transaction((): boolean => {
      const updated = db
        .prepare(
          `UPDATE accounts
           SET status = 'active', auth_method = 'entra', external_id = ?,
               invite_token_hash = NULL, invite_expires_at = NULL, invite_revoked_at = NULL
           WHERE id = ? AND status = 'invited'`,
        )
        .run(profile.oid, invited.id)
      if (updated.changes === 0) return false
      db.prepare("UPDATE people SET account_uid = ? WHERE account_uid = ?").run(
        profile.oid,
        formatLocalAccountUid(invited.id),
      )
      return true
    })
    .immediate()

  return claimed ? { claimed: true, accountId: invited.id } : { claimed: false }
}
