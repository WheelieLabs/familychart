// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/auth-helpers"
import { logger } from "@/lib/logger"
import { clientIpFromHeaders } from "@/lib/client-ip"
import {
  isAuthRateLimited,
  recordAuthFailure,
} from "@/lib/auth/auth-rate-limit"

const PHASES = new Set(["create", "get", "verify"])
/** Ceiling well past the longest ceremony safety net (~65s, see components/AppLockOverlay.tsx). */
const MAX_ELAPSED_MS = 5 * 60_000
const MAX_USER_AGENT_LENGTH = 300

function appLockFailureLogRateLimitKey(accountId: string): string {
  return `app-lock-failure-log:${accountId}`
}

/**
 * Accepts App lock WebAuthn ceremony failure reports so a recurrence of the September 2026
 * Pixel regression (ADR-0016) is noticed on the server before a user reports it. Never
 * accepts a credential id, challenge, or any authenticator data — only enough to notice and
 * tell failures apart.
 */
export async function POST(request: Request) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const accountId = session.user.id ?? ""
  if (isAuthRateLimited(appLockFailureLogRateLimitKey(accountId))) {
    return NextResponse.json({ error: "Too many reports. Try again later." }, { status: 429 })
  }
  recordAuthFailure(appLockFailureLogRateLimitKey(accountId), Date.now(), 20)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (body == null || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid report" }, { status: 400 })
  }

  const allowedKeys = new Set(["phase", "errorName", "elapsedMs", "userAgent"])
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      return NextResponse.json({ error: "Unexpected field" }, { status: 400 })
    }
  }

  const { phase, errorName, elapsedMs, userAgent } = body as {
    phase?: unknown
    errorName?: unknown
    elapsedMs?: unknown
    userAgent?: unknown
  }
  if (typeof phase !== "string" || !PHASES.has(phase)) {
    return NextResponse.json({ error: "Invalid phase" }, { status: 400 })
  }
  if (typeof errorName !== "string" || !errorName || errorName.length > 100) {
    return NextResponse.json({ error: "Invalid errorName" }, { status: 400 })
  }
  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > MAX_ELAPSED_MS) {
    return NextResponse.json({ error: "Invalid elapsedMs" }, { status: 400 })
  }
  if (typeof userAgent !== "string" || userAgent.length > MAX_USER_AGENT_LENGTH) {
    return NextResponse.json({ error: "Invalid userAgent" }, { status: 400 })
  }

  const ip = clientIpFromHeaders(request.headers)
  logger.warn("app_lock_ceremony_failure", {
    account_id: accountId,
    phase,
    error_name: errorName,
    elapsed_ms: elapsedMs,
    user_agent: userAgent,
    ip,
  })

  return NextResponse.json({ success: true })
}
