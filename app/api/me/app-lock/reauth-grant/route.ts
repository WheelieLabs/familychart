// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { parseLocalAccountUid } from "@/lib/account/account-uid"
import { clientIpFromHeaders } from "@/lib/client-ip"
import { confirmAppLockReauth } from "@/lib/account/account-local-reauth"
import { isEntraAppLockReauthFresh } from "@/lib/app-lock/app-lock-reauth"
import type { AppSession } from "@/lib/session"

/**
 * Proves the Account holder is present again before App lock can be turned off — on the
 * lock screen's "turn off App lock on this device" and in Profile (ADR-0016:
 * "someone who picks up my unlocked phone can't disable it"). Grants nothing beyond this
 * one-shot `{granted: true}` response; the client writes its own device-local opt-out
 * immediately after, same as any other App lock setting.
 */
export async function POST(request: Request) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult
  const db = getDb()

  const localId = parseLocalAccountUid(session.user.id)
  if (localId != null) {
    const ip = clientIpFromHeaders(request.headers)
    let body: { password?: string; otp?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }
    if (!body.password) {
      return NextResponse.json({ error: "Password is required" }, { status: 400 })
    }

    const result = await confirmAppLockReauth(db, localId, { password: body.password, otp: body.otp, ip })
    if (!result.ok) {
      if (result.reason === "credentials") {
        auditLog(db, session.user?.email, "AUTH_FAILURE", "accounts", localId, {
          route: "me/app-lock/reauth-grant",
          reason: "password",
        })
        return NextResponse.json({ error: "Invalid password" }, { status: 401 })
      }
      if (result.reason === "otp_missing") {
        return NextResponse.json({ error: "Authenticator code is required" }, { status: 400 })
      }
      if (result.reason === "otp_invalid") {
        auditLog(db, session.user?.email, "AUTH_FAILURE", "accounts", localId, {
          route: "me/app-lock/reauth-grant",
          reason: "otp",
        })
        return NextResponse.json({ error: "Invalid authenticator code" }, { status: 400 })
      }
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 })
    }

    auditLog(db, session.user?.email, "AUTH_SUCCESS", "accounts", localId, {
      route: "me/app-lock/reauth-grant",
    })
    return NextResponse.json({ granted: true })
  }

  if (session.user.entraOid) {
    const entraAuthAt = (session as AppSession).entraAuthAt
    if (!isEntraAppLockReauthFresh(entraAuthAt, Date.now())) {
      return NextResponse.json(
        { error: "Sign in again with Microsoft to confirm it's you." },
        { status: 401 },
      )
    }
    auditLog(db, session.user?.email, "AUTH_SUCCESS", "accounts", null, {
      route: "me/app-lock/reauth-grant",
      entra_oid: session.user.entraOid,
    })
    return NextResponse.json({ granted: true })
  }

  return NextResponse.json({ error: "Not applicable" }, { status: 403 })
}
