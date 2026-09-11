// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/auth-helpers"
import { isDemoModeActive } from "@/lib/demo/demo-mode"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { parseLocalAccountUid } from "@/lib/account/account-uid"
import { clientIpFromHeaders } from "@/lib/client-ip"
import { confirmEnrollment } from "@/lib/account/account-local-reauth"

export async function POST(request: Request) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult
  if (isDemoModeActive())
    return NextResponse.json({ error: "This is a demo environment — account changes are disabled." }, { status: 403 })

  const localId = parseLocalAccountUid(session.user.id)
  if (localId == null) {
    return NextResponse.json({ error: "Not applicable" }, { status: 403 })
  }

  const ip = clientIpFromHeaders(request.headers)

  let body: { code?: string; password?: string; otp?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const code = body.code?.replace(/\s/g, "") ?? ""
  const password = body.password
  if (!code) return NextResponse.json({ error: "Code is required" }, { status: 400 })
  if (!password) return NextResponse.json({ error: "Password is required" }, { status: 400 })

  const db = getDb()
  const result = await confirmEnrollment(db, localId, { password, otp: body.otp, code, ip })
  if (!result.ok) {
    if (result.reason === "credentials") {
      auditLog(db, session.user?.email, "AUTH_FAILURE", "accounts", localId, {
        route: "me/mfa/confirm",
        reason: "password",
      })
      return NextResponse.json({ error: "Invalid password" }, { status: 401 })
    }
    if (result.reason === "no_pending") {
      return NextResponse.json({ error: "No setup in progress. Start again." }, { status: 400 })
    }
    if (result.reason === "otp_missing") {
      return NextResponse.json(
        { error: "Current authenticator code is required to replace an existing enrolment" },
        { status: 400 },
      )
    }
    if (result.reason === "otp_invalid") {
      auditLog(db, session.user?.email, "AUTH_FAILURE", "accounts", localId, {
        route: "me/mfa/confirm",
        reason: "otp",
      })
      return NextResponse.json({ error: "Invalid current authenticator code" }, { status: 400 })
    }
    if (result.reason === "code_invalid") {
      auditLog(db, session.user?.email, "AUTH_FAILURE", "accounts", localId, {
        route: "me/mfa/confirm",
        reason: "otp",
      })
      return NextResponse.json({ error: "Invalid code" }, { status: 400 })
    }
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 })
  }

  auditLog(db, session.user?.email, "UPDATE", "accounts", localId, { totp_enrolled: true })
  return NextResponse.json({ success: true })
}
