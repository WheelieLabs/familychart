// SPDX-License-Identifier: AGPL-3.0-only

import bcrypt from "bcryptjs"
import { generateSecret, generateURI, verifySync } from "otplib"
import type Database from "better-sqlite3-multiple-ciphers"

import {
  clearAuthFailuresForLocalUser,
  isAuthRateLimitedForLocalUser,
  recordAuthFailureForLocalUser,
} from "@/lib/auth/auth-rate-limit"
import { bumpLocalUserSessionVersion } from "@/lib/local-user-session"
import { validateNewPassword } from "@/lib/password-policy"
import { isManagedPlatformProfile } from "@/lib/platform-profile"
import { resolveSetting } from "@/lib/settings/resolver"
import { SETTING_SECURITY_MFA_REQUIRED } from "@/lib/settings/registry"
import type { Account } from "@/lib/domain-types"

export interface LocalReauthProof {
  password: string
  /** Current authenticator code, when the Account already has TOTP enrolled. */
  otp?: string
  ip: string
}

type ProveResult =
  | { ok: true; user: Account }
  | { ok: false; reason: "rate_limited" | "credentials" }

/**
 * Local Account re-auth proof (see CONTEXT.md): rate-limit then password check against an
 * active local Account, composed from lib/auth-rate-limit.ts and keyed by local user id —
 * not email, since the caller is already authenticated. Internal to this module; no other
 * module should import a password-proving helper.
 */
async function proveLocalAccount(
  db: Database.Database,
  localAccountId: number,
  { password, ip }: Pick<LocalReauthProof, "password" | "ip">,
): Promise<ProveResult> {
  if (isAuthRateLimitedForLocalUser(ip, localAccountId)) {
    return { ok: false, reason: "rate_limited" }
  }
  const user = db
    .prepare("SELECT * FROM accounts WHERE id = ? AND is_active = 1")
    .get(localAccountId) as Account | undefined
  const ok = user?.password_hash ? await bcrypt.compare(password, user.password_hash) : false
  if (!user || !ok) {
    recordAuthFailureForLocalUser(ip, localAccountId)
    return { ok: false, reason: "credentials" }
  }
  return { ok: true, user }
}

function normaliseOtp(otp: string | undefined): string {
  return otp?.replace(/\s/g, "") ?? ""
}

export type StartEnrollmentResult =
  | { ok: true; otpauthUri: string }
  | { ok: false; reason: "rate_limited" | "credentials" | "otp_missing" | "otp_invalid" }

/**
 * Starts (or replaces) TOTP enrollment: on proof, mints a pending secret and returns its
 * otpauth URI. The route builds the QR code — this module only ever deals in the URI.
 */
export async function startEnrollment(
  db: Database.Database,
  localAccountId: number,
  { password, otp, ip }: LocalReauthProof,
): Promise<StartEnrollmentResult> {
  const proof = await proveLocalAccount(db, localAccountId, { password, ip })
  if (!proof.ok) return proof
  const { user } = proof

  if (user.totp_secret) {
    const code = normaliseOtp(otp)
    if (!code) {
      recordAuthFailureForLocalUser(ip, localAccountId)
      return { ok: false, reason: "otp_missing" }
    }
    const { valid } = verifySync({ token: code, secret: user.totp_secret, epochTolerance: 30 })
    if (!valid) {
      recordAuthFailureForLocalUser(ip, localAccountId)
      return { ok: false, reason: "otp_invalid" }
    }
  }

  const secret = generateSecret()
  db.prepare("UPDATE accounts SET totp_secret_pending = ? WHERE id = ? AND is_active = 1").run(
    secret,
    localAccountId,
  )
  const otpauthUri = generateURI({ issuer: "FamilyChart", label: user.email, secret })

  clearAuthFailuresForLocalUser(ip, localAccountId)
  return { ok: true, otpauthUri }
}

export interface ConfirmEnrollmentInput extends LocalReauthProof {
  /** The code from the pending secret's authenticator, proving the enrollment. */
  code: string
}

export type ConfirmEnrollmentResult =
  | { ok: true }
  | {
      ok: false
      // otp_missing/otp_invalid: the *current* authenticator code, required when replacing an
      // existing enrollment. code_invalid: the *new* pending secret's code, always required.
      reason: "rate_limited" | "credentials" | "otp_missing" | "otp_invalid" | "code_invalid" | "no_pending"
    }

/** Promotes a pending TOTP secret to active, clears the pending slot, and bumps `session_version`. */
export async function confirmEnrollment(
  db: Database.Database,
  localAccountId: number,
  { password, otp, code, ip }: ConfirmEnrollmentInput,
): Promise<ConfirmEnrollmentResult> {
  const proof = await proveLocalAccount(db, localAccountId, { password, ip })
  if (!proof.ok) return proof

  const row = db
    .prepare("SELECT totp_secret_pending, totp_secret FROM accounts WHERE id = ? AND is_active = 1")
    .get(localAccountId) as { totp_secret_pending: string | null; totp_secret: string | null } | undefined
  if (!row?.totp_secret_pending) {
    return { ok: false, reason: "no_pending" }
  }

  if (row.totp_secret) {
    const existingOtp = normaliseOtp(otp)
    if (!existingOtp) {
      recordAuthFailureForLocalUser(ip, localAccountId)
      return { ok: false, reason: "otp_missing" }
    }
    const { valid: existingOk } = verifySync({
      token: existingOtp,
      secret: row.totp_secret,
      epochTolerance: 30,
    })
    if (!existingOk) {
      recordAuthFailureForLocalUser(ip, localAccountId)
      return { ok: false, reason: "otp_invalid" }
    }
  }

  const { valid } = verifySync({ token: normaliseOtp(code), secret: row.totp_secret_pending, epochTolerance: 30 })
  if (!valid) {
    recordAuthFailureForLocalUser(ip, localAccountId)
    return { ok: false, reason: "code_invalid" }
  }

  db.prepare("UPDATE accounts SET totp_secret = ?, totp_secret_pending = NULL WHERE id = ?").run(
    row.totp_secret_pending,
    localAccountId,
  )
  bumpLocalUserSessionVersion(db, localAccountId)
  clearAuthFailuresForLocalUser(ip, localAccountId)
  return { ok: true }
}

export type DisableTotpResult =
  | { ok: true }
  | {
      ok: false
      reason: "mfa_required" | "rate_limited" | "not_enrolled" | "credentials" | "otp_missing" | "otp_invalid"
    }

/**
 * Disables TOTP on proof. Refused outright as `mfa_required` while `security.mfa_required`
 * (or managed hosting) is in effect — recovery in that state is Admin `clear_mfa` on
 * `PUT /api/accounts/[id]`, not this module.
 */
export async function disableTotp(
  db: Database.Database,
  localAccountId: number,
  { password, otp, ip }: LocalReauthProof,
): Promise<DisableTotpResult> {
  if (isMfaRequiredPolicyActive(db)) {
    return { ok: false, reason: "mfa_required" }
  }
  if (isAuthRateLimitedForLocalUser(ip, localAccountId)) {
    return { ok: false, reason: "rate_limited" }
  }

  const user = db
    .prepare("SELECT * FROM accounts WHERE id = ? AND is_active = 1")
    .get(localAccountId) as Account | undefined
  if (!user?.totp_secret || !user.password_hash) {
    return { ok: false, reason: "not_enrolled" }
  }

  const pwOk = await bcrypt.compare(password, user.password_hash)
  if (!pwOk) {
    recordAuthFailureForLocalUser(ip, localAccountId)
    return { ok: false, reason: "credentials" }
  }

  const code = normaliseOtp(otp)
  if (!code) {
    recordAuthFailureForLocalUser(ip, localAccountId)
    return { ok: false, reason: "otp_missing" }
  }
  const { valid } = verifySync({ token: code, secret: user.totp_secret, epochTolerance: 30 })
  if (!valid) {
    recordAuthFailureForLocalUser(ip, localAccountId)
    return { ok: false, reason: "otp_invalid" }
  }

  db.prepare("UPDATE accounts SET totp_secret = NULL, totp_secret_pending = NULL WHERE id = ?").run(localAccountId)
  bumpLocalUserSessionVersion(db, localAccountId)
  clearAuthFailuresForLocalUser(ip, localAccountId)
  return { ok: true }
}

export interface ChangePasswordInput extends LocalReauthProof {
  newPassword: string
  confirmPassword: string
}

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: "rate_limited" | "credentials" }
  | { ok: false; reason: "policy"; message: string }

/**
 * Changes the Account's password on proof and bumps `session_version`. New-password policy
 * (length, confirm match) is checked before the current-password proof, matching the route's
 * existing behaviour — a caller who fails policy never burns a rate-limit attempt.
 */
export async function changePassword(
  db: Database.Database,
  localAccountId: number,
  { password, newPassword, confirmPassword, ip }: ChangePasswordInput,
): Promise<ChangePasswordResult> {
  if (isAuthRateLimitedForLocalUser(ip, localAccountId)) {
    return { ok: false, reason: "rate_limited" }
  }

  const policyError = validateNewPassword(db, newPassword, confirmPassword, "New passwords do not match")
  if (policyError) {
    return { ok: false, reason: "policy", message: policyError }
  }

  const user = db
    .prepare("SELECT * FROM accounts WHERE id = ? AND is_active = 1")
    .get(localAccountId) as Account | undefined
  const ok = user?.password_hash ? await bcrypt.compare(password, user.password_hash) : false
  if (!user || !ok) {
    recordAuthFailureForLocalUser(ip, localAccountId)
    return { ok: false, reason: "credentials" }
  }

  const password_hash = await bcrypt.hash(newPassword, 12)
  db.prepare("UPDATE accounts SET password_hash = ? WHERE id = ?").run(password_hash, localAccountId)
  bumpLocalUserSessionVersion(db, localAccountId)
  clearAuthFailuresForLocalUser(ip, localAccountId)
  return { ok: true }
}

/**
 * True when `security.mfa_required` is in effect: always on managed hosting (mandatory
 * regardless of the DB/env setting), otherwise follows the resolved setting.
 */
export function isMfaRequiredPolicyActive(db: Database.Database): boolean {
  if (isManagedPlatformProfile()) return true
  return resolveSetting(db, SETTING_SECURITY_MFA_REQUIRED).value === "true"
}

/**
 * True when this local Account must complete TOTP in Profile before using the app.
 * Gated on the `security.mfa_required` policy — mandatory on managed hosting;
 * on self-hosted, only forced when the policy is enabled.
 */
export function localUserNeedsMfaEnrollment(db: Database.Database, localAccountId: number): boolean {
  const row = db
    .prepare("SELECT totp_secret FROM accounts WHERE id = ? AND is_active = 1")
    .get(localAccountId) as { totp_secret: string | null } | undefined
  const hasNoTotp = !row?.totp_secret?.length
  if (!hasNoTotp) return false
  return isMfaRequiredPolicyActive(db)
}
