// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/auth-helpers"
import { isDemoModeActive } from "@/lib/demo/demo-mode"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { parseLocalAccountUid } from "@/lib/account/account-uid"
import { clientIpFromHeaders } from "@/lib/client-ip"
import { changePassword } from "@/lib/account/account-local-reauth"

export async function POST(request: Request) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  if (isDemoModeActive()) {
    return NextResponse.json({ error: "Password changes are disabled in demo mode" }, { status: 403 })
  }

  const localId = parseLocalAccountUid(session.user.id)
  if (localId == null) {
    return NextResponse.json({ error: "Not applicable" }, { status: 403 })
  }

  const ip = clientIpFromHeaders(request.headers)

  let body: { currentPassword?: string; newPassword?: string; confirmPassword?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { currentPassword, newPassword, confirmPassword } = body
  if (!currentPassword || !newPassword || !confirmPassword) {
    return NextResponse.json({ error: "All fields are required" }, { status: 400 })
  }

  const db = getDb()
  const result = await changePassword(db, localId, {
    password: currentPassword,
    newPassword,
    confirmPassword,
    ip,
  })
  if (!result.ok) {
    if (result.reason === "policy") {
      return NextResponse.json({ error: result.message }, { status: 400 })
    }
    if (result.reason === "credentials") {
      auditLog(db, session.user?.email, "AUTH_FAILURE", "accounts", localId, {
        route: "me/password",
        reason: "password",
      })
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 })
    }
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 })
  }

  auditLog(db, session.user?.email, "UPDATE", "accounts", localId, { password_changed: true })
  return NextResponse.json({ success: true })
}
