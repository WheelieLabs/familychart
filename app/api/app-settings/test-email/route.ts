// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { isOutboundEmailConfigured, sendTestEmail } from "@/lib/email-send"
import {
  clearAuthFailures,
  isAuthRateLimited,
  recordAuthFailure,
} from "@/lib/auth/auth-rate-limit"
import { clientIpFromHeaders } from "@/lib/client-ip"

const TEST_EMAIL_MAX_FAILURES = 5

function testEmailRateKey(ip: string, email: string): string {
  return `test-email:${ip}|${email.trim().toLowerCase()}`
}

export async function POST(request: Request) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const to = session.user?.email?.trim()
  if (!to) {
    return NextResponse.json({ error: "No email on admin session" }, { status: 400 })
  }

  const ip = clientIpFromHeaders(request.headers)
  const rateKey = testEmailRateKey(ip, to)
  if (isAuthRateLimited(rateKey)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 })
  }

  const db = getDb()
  if (!isOutboundEmailConfigured(db)) {
    return NextResponse.json({ error: "Outbound email is not configured" }, { status: 400 })
  }

  const result = await sendTestEmail(db, to)
  if (!result.ok) {
    recordAuthFailure(rateKey, Date.now(), TEST_EMAIL_MAX_FAILURES)
    auditLog(db, session.user?.email, "TEST", "email", null, { ok: false })
    return NextResponse.json({ error: result.error }, { status: 502 })
  }

  clearAuthFailures(rateKey)
  auditLog(db, session.user?.email, "TEST", "email", null, { ok: true, to })
  return NextResponse.json({ ok: true, to })
}
