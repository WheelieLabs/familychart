// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import QRCode from "qrcode"
import { requireAuth } from "@/lib/auth/auth-helpers"
import { isDemoModeActive } from "@/lib/demo/demo-mode"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { parseLocalAccountUid } from "@/lib/account/account-uid"
import { clientIpFromHeaders } from "@/lib/client-ip"
import { startEnrollment } from "@/lib/account/account-local-reauth"

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
  if (!password) {
    return NextResponse.json({ error: "Password is required" }, { status: 400 })
  }

  const db = getDb()
  const result = await startEnrollment(db, localId, { password, otp: body.otp, ip })
  if (!result.ok) {
    if (result.reason === "credentials") {
      auditLog(db, session.user?.email, "AUTH_FAILURE", "accounts", localId, {
        route: "me/mfa/setup",
        reason: "password",
      })
      return NextResponse.json({ error: "Invalid password" }, { status: 401 })
    }
    if (result.reason === "otp_missing") {
      return NextResponse.json(
        { error: "Current authenticator code is required to replace an existing enrolment" },
        { status: 400 },
      )
    }
    if (result.reason === "otp_invalid") {
      auditLog(db, session.user?.email, "AUTH_FAILURE", "accounts", localId, {
        route: "me/mfa/setup",
        reason: "otp",
      })
      return NextResponse.json({ error: "Invalid code" }, { status: 400 })
    }
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 })
  }

  let qrDataUrl: string
  try {
    qrDataUrl = await QRCode.toDataURL(result.otpauthUri, { margin: 1, width: 200 })
  } catch {
    qrDataUrl = ""
  }

  return NextResponse.json({ otpauthUrl: result.otpauthUri, qrDataUrl })
}
