// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/auth-helpers"
import { parseLocalAccountUid } from "@/lib/account/account-uid"
import { isDemoModeActive } from "@/lib/demo/demo-mode"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { clientIpFromHeaders } from "@/lib/client-ip"
import { disableTotp } from "@/lib/account/account-local-reauth"

export async function POST(request: Request) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const localId = parseLocalAccountUid(session.user.id)
  if (localId == null) {
    return NextResponse.json({ error: "Not applicable" }, { status: 403 })
  }

  if (isDemoModeActive()) {
    return NextResponse.json({ error: "MFA changes are disabled in demo mode" }, { status: 403 })
  }

  const ip = clientIpFromHeaders(request.headers)

  let body: { password?: string; otp?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const password = body.password
  const otp = body.otp?.replace(/\s/g, "") ?? ""
  if (!password || !otp) {
    return NextResponse.json({ error: "Password and authenticator code are required" }, { status: 400 })
  }

  const db = getDb()
  const result = await disableTotp(db, localId, { password, otp, ip })
  if (!result.ok) {
    if (result.reason === "mfa_required") {
      return NextResponse.json(
        { error: "Authenticator cannot be disabled while MFA is required on this instance" },
        { status: 403 },
      )
    }
    if (result.reason === "not_enrolled") {
      return NextResponse.json({ error: "Authenticator is not enabled" }, { status: 400 })
    }
    if (result.reason === "credentials") {
      auditLog(db, session.user?.email, "AUTH_FAILURE", "accounts", localId, {
        route: "me/mfa/disable",
        reason: "password",
      })
      return NextResponse.json({ error: "Invalid password" }, { status: 401 })
    }
    if (result.reason === "otp_missing" || result.reason === "otp_invalid") {
      auditLog(db, session.user?.email, "AUTH_FAILURE", "accounts", localId, {
        route: "me/mfa/disable",
        reason: "otp",
      })
      return NextResponse.json({ error: "Invalid code" }, { status: 400 })
    }
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 })
  }

  auditLog(db, session.user?.email, "UPDATE", "accounts", localId, { totp_disabled: true })
  return NextResponse.json({ success: true })
}
