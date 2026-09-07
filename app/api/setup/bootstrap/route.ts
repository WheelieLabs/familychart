// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { rejectDemoProfanity } from "@/lib/demo/demo-profanity-guard"
import { createFirstAdmin, isBootstrapEndpointAllowed } from "@/lib/setup-bootstrap"
import { isAdminSeen, isSetupComplete } from "@/lib/setup-gate"
import { hasAnyLocalAccount, isEmailTakenByAnyAccount } from "@/lib/local-account-gate"
import { getDb } from "@/lib/db"
import { validateNewPassword } from "@/lib/password-policy"
import { logger } from "@/lib/logger"
import { clientIpFromHeaders } from "@/lib/client-ip"
import { isBootstrapRateLimited, recordBootstrapAttempt } from "@/lib/auth/auth-rate-limit"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: NextRequest) {
  if (!isBootstrapEndpointAllowed()) {
    return NextResponse.json({ error: "Bootstrap is not available on this instance" }, { status: 403 })
  }

  let body: { email?: string; password?: string; confirmPassword?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const email =
    typeof body.email === "string" ? body.email.trim() : ""
  const password = typeof body.password === "string" ? body.password : ""
  const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : ""

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 })
  }

  const db = getDb()

  // Cheap pre-check, same predicates and order as createFirstAdmin's authoritative
  // transaction below — lets an already-closed bootstrap window (or a taken email) short-circuit
  // before the profanity fetch and bcrypt, without weakening the TOCTOU-safe re-check.
  if (isSetupComplete(db)) {
    return NextResponse.json({ error: "Setup already complete" }, { status: 403 })
  }
  if (isAdminSeen(db)) {
    return NextResponse.json({ error: "An administrator already exists" }, { status: 403 })
  }
  if (hasAnyLocalAccount(db)) {
    return NextResponse.json({ error: "Local accounts already exist" }, { status: 403 })
  }
  if (isEmailTakenByAnyAccount(db, email)) {
    return NextResponse.json({ error: "Email already exists" }, { status: 409 })
  }

  const passwordError = validateNewPassword(db, password, confirmPassword)
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 })
  }

  const ip = clientIpFromHeaders(request.headers)
  if (isBootstrapRateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }
  recordBootstrapAttempt(ip)

  const profanity = await rejectDemoProfanity(email)
  if (profanity) return profanity

  const password_hash = await bcrypt.hash(password, 12)

  try {
    const created = createFirstAdmin(db, email, password_hash)
    if (created.status !== 201) {
      return NextResponse.json({ error: created.error }, { status: created.status })
    }
    logger.info("first_admin_created", { email })
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    logger.error("bootstrap_failed", err instanceof Error ? err : { detail: String(err) })
    return NextResponse.json({ error: "Bootstrap failed" }, { status: 500 })
  }
}
