// SPDX-License-Identifier: AGPL-3.0-only

import bcrypt from "bcryptjs"
import { verifySync } from "otplib"
import type Database from "better-sqlite3-multiple-ciphers"

import { logger } from "@/lib/logger"
import {
  clearAuthFailuresFor,
  DUMMY_BCRYPT_HASH,
  isAuthRateLimitedFor,
  recordAuthFailureFor,
} from "@/lib/auth/auth-rate-limit"
import { isDemoModeActive } from "@/lib/demo/demo-mode"
import { formatLocalAccountUid } from "@/lib/account/account-uid"
import { localRoleToGroups, loadLocalUserSessionRow } from "@/lib/local-user-session"
import type { Account } from "@/lib/domain-types"

export interface LocalAccountSignInInput {
  email: string
  password: string
  otp?: string
  ip: string
}

export interface LocalAccountSessionBag {
  id: string
  email: string
  name: string
  groups: string[]
  sessionVersion: number
}

export type LocalAccountSignInResult =
  | { ok: true; session: LocalAccountSessionBag }
  | { ok: false; reason: "rate_limited" | "credentials" | "otp_missing" | "otp_invalid" }

/**
 * The Local Account sign-in check (see CONTEXT.md): password-and-TOTP against an active
 * local Account, yielding a session bag or a tagged deny. Owns rate-limiting, the dummy-hash
 * timing shield, TOTP (including the demo `123456` bypass), `auth_login_failed` logging, and
 * building the session bag — everything the Credentials `authorize` factory used to inline.
 *
 * Missing/inactive Accounts and a wrong password are all tagged `credentials` — deliberately
 * indistinguishable so account existence is not enumerable.
 */
export async function localAccountSignIn(
  db: Database.Database,
  { email, password, otp: otpRaw, ip }: LocalAccountSignInInput,
): Promise<LocalAccountSignInResult> {
  if (isAuthRateLimitedFor(ip, email)) {
    logger.warn("auth_login_failed", { reason: "rate_limited", ip, email })
    return { ok: false, reason: "rate_limited" }
  }

  // Case-insensitive: invite-created accounts always store email lowercased
  // (app/api/accounts/invites/route.ts), but an invitee naturally types their own
  // email with whatever casing they normally use — an exact-match lookup here would
  // lock them out of an account they just created.
  const user = db
    .prepare("SELECT * FROM accounts WHERE lower(email) = lower(?) AND is_active = 1")
    .get(email) as Account | undefined

  const hash = user?.password_hash ?? DUMMY_BCRYPT_HASH
  const ok = await bcrypt.compare(password, hash)
  if (!user || !ok) {
    recordAuthFailureFor(ip, email)
    logger.warn("auth_login_failed", { reason: "credentials", ip, email })
    return { ok: false, reason: "credentials" }
  }

  const secret = user.totp_secret?.trim()
  if (secret) {
    const otp = otpRaw?.replace(/\s/g, "") ?? ""
    if (!otp) {
      recordAuthFailureFor(ip, email)
      logger.warn("auth_login_failed", { reason: "otp_missing", ip, email })
      return { ok: false, reason: "otp_missing" }
    }
    if (!isDemoModeActive() || otp !== "123456") {
      const { valid } = verifySync({ secret, token: otp, epochTolerance: 30 })
      if (!valid) {
        recordAuthFailureFor(ip, email)
        logger.warn("auth_login_failed", { reason: "otp_invalid", ip, email })
        return { ok: false, reason: "otp_invalid" }
      }
    }
  }

  clearAuthFailuresFor(ip, email)
  const sessionRow = loadLocalUserSessionRow(db, user.id)

  return {
    ok: true,
    session: {
      id:     formatLocalAccountUid(user.id),
      email:  user.email,
      name:   user.email,
      groups: localRoleToGroups(user.role, user.can_report),
      sessionVersion: sessionRow?.session_version ?? 0,
    },
  }
}
