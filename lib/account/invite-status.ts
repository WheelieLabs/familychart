// SPDX-License-Identifier: AGPL-3.0-only

// Client-safe: no database or Node imports, so the Accounts screen can read invite status.

export interface InviteLifecycleFields {
  status: string
  invite_expires_at: string | null
  invite_revoked_at: string | null
}

/**
 * Single encoding of Invite liveness (see CONTEXT.md "Invite"): the one place `linkable`
 * (list and create), the dead-Invite link guard, and display status all read from, so they
 * cannot diverge the way three separate encodings could before this module existed.
 */
export function isInviteLive(row: InviteLifecycleFields, nowMs: number): boolean {
  if (row.status !== "invited") return false
  if (row.invite_revoked_at != null) return false
  if (row.invite_expires_at == null) return false
  return new Date(row.invite_expires_at).getTime() > nowMs
}

type AccountInviteState = "active" | "invited" | "expired" | "revoked"

function inviteState(
  row: InviteLifecycleFields,
  nowMs: number = Date.now(),
): AccountInviteState {
  if (row.status !== "invited") return "active"
  if (row.invite_revoked_at != null) return "revoked"
  return isInviteLive(row, nowMs) ? "invited" : "expired"
}


export type AccountChip = AccountInviteState | "disabled"

export interface AccountStatusFields extends InviteLifecycleFields {
  auth_method: "local" | "entra"
  is_active: number
}

export interface AccountStatus {
  /** Invite lifecycle only: drives the Revoke and Resend buttons. */
  invite: AccountInviteState
  /** The one chip shown on the row. */
  chip: AccountChip
  /** A local account an admin has disabled. Never true for Entra, where sign-in is governed by Entra. */
  disabled: boolean
}

/** `accounts.is_active` gates sign-in for local accounts only; Entra access comes from Entra (ADR-0009). */
export function isSignInManagedLocally(authMethod: string): boolean {
  return authMethod === "local"
}

/**
 * The one helper for an account's status: the invite state (drives Revoke and Resend) and the
 * combined chip (display). Precedence Disabled > Revoked > Expired > Invited > Active; `is_active` is ignored for Entra accounts.
 */
export function accountStatus(row: AccountStatusFields, nowMs: number = Date.now()): AccountStatus {
  const invite = inviteState(row, nowMs)
  const disabled = isSignInManagedLocally(row.auth_method) && row.is_active === 0
  return { invite, chip: disabled ? "disabled" : invite, disabled }
}
