// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { redeemResetToken, verifyResetToken } from "@/lib/reset-token"
import { validateNewPassword } from "@/lib/password-policy"
import { logger } from "@/lib/logger"
import { clientIpFromHeaders } from "@/lib/client-ip"
import { isResetPasswordRateLimited, recordResetPasswordAttempt } from "@/lib/auth/auth-rate-limit"

const INVALID_TOKEN_ERROR = "This reset link is invalid or has expired"

/**
 * Verifies a managed-admin first-login reset token (via lib/reset-token.ts), sets the new
 * password, and clears the account's forced-reset flag. No session is issued here — the
 * client completes auto sign-in itself via the credentials provider, using the email
 * returned on success (see ADR-0014).
 */
export async function POST(request: NextRequest) {
  let body: { token?: string; password?: string; confirmPassword?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const token = typeof body.token === "string" ? body.token : ""
  const password = typeof body.password === "string" ? body.password : ""
  const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : ""

  if (!token) return NextResponse.json({ error: "Token is required" }, { status: 400 })

  const db = getDb()
  const passwordError = validateNewPassword(db, password, confirmPassword)
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 })
  }

  const ip = clientIpFromHeaders(request.headers)
  if (isResetPasswordRateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }
  recordResetPasswordAttempt(ip)

  const secret = process.env.NEXTAUTH_SECRET?.trim()
  if (!secret) {
    logger.error("reset_password_no_secret")
    return NextResponse.json({ error: "Reset is not available on this instance" }, { status: 500 })
  }

  // Cheap signature/expiry/flag check before the expensive bcrypt hash below, so a bad/
  // expired/tampered token doesn't cost a cost-12 bcrypt round on every rate-limited
  // attempt. redeemResetToken re-verifies atomically inside its own transaction — this is
  // purely a cost-avoidance short-circuit, not the source of truth.
  if (!verifyResetToken(db, token, secret).valid) {
    return NextResponse.json({ error: INVALID_TOKEN_ERROR }, { status: 400 })
  }

  const password_hash = await bcrypt.hash(password, 12)

  const result = redeemResetToken(db, token, secret, password_hash)
  if (!result.ok) {
    return NextResponse.json({ error: INVALID_TOKEN_ERROR }, { status: 400 })
  }

  auditLog(db, result.email, "UPDATE", "accounts", Number(result.userId), { forced_reset_completed: true })
  logger.info("forced_reset_completed", { email: result.email })

  return NextResponse.json({ ok: true, email: result.email })
}
