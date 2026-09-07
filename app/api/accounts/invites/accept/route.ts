// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { redeemInvite, verifyInviteToken } from "@/lib/invite"
import { validateNewPassword } from "@/lib/password-policy"
import { logger } from "@/lib/logger"
import { clientIpFromHeaders } from "@/lib/client-ip"
import { isInviteAcceptRateLimited, recordInviteAcceptAttempt } from "@/lib/auth/auth-rate-limit"

const INVALID_TOKEN_ERROR = "This invite link is invalid or has expired"

/**
 * Verifies a pending invite token (via lib/invite.ts), sets the invitee's chosen
 * password, and flips the account to active. No session is issued here — the client
 * completes auto sign-in itself via the credentials provider, using the email returned
 * on success, mirroring app/api/auth/reset-password/route.ts.
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
  if (isInviteAcceptRateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }
  recordInviteAcceptAttempt(ip)

  // Cheap hash-lookup pre-check before the expensive bcrypt hash below, so a bad/expired/
  // revoked token doesn't cost a cost-12 bcrypt round on every rate-limited attempt.
  // redeemInvite re-verifies atomically inside its own transaction — this is purely a
  // cost-avoidance short-circuit, not the source of truth.
  if (!verifyInviteToken(db, token).valid) {
    return NextResponse.json({ error: INVALID_TOKEN_ERROR }, { status: 400 })
  }

  const password_hash = await bcrypt.hash(password, 12)

  const result = redeemInvite(db, token, password_hash)
  if (!result.ok) {
    return NextResponse.json({ error: INVALID_TOKEN_ERROR }, { status: 400 })
  }

  auditLog(db, result.email, "UPDATE", "accounts", result.accountId, { invite_accepted: true })
  logger.info("invite_accepted", { email: result.email })

  return NextResponse.json({ ok: true, email: result.email })
}
