// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { confirmAppLockReauth } from "@/lib/account/account-local-reauth"
import { parseLocalAccountUid } from "@/lib/account/account-uid"
import {
  AccountRemovalError,
  accountRemovalRewriteCounts,
  DEMO_ACCOUNT_CHANGES_ERROR,
  removeAccount,
  SELF_REAUTH_ERROR,
} from "@/lib/account/remove-account"
import { ACCOUNT_STILL_LINKED_ERROR, REMOVAL_WARNING } from "@/lib/account/account-removal-messages"
import { isLastLocalAdmin, LAST_LOCAL_ADMIN_ERROR } from "@/lib/account/last-local-admin"
import { isEntraAppLockReauthFresh } from "@/lib/app-lock/app-lock-reauth"
import { requireAuth } from "@/lib/auth/auth-helpers"
import { clientIpFromHeaders } from "@/lib/client-ip"
import { actorRoleForLog } from "@/lib/data-event-log"
import { isDemoModeActive } from "@/lib/demo/demo-mode"
import { getDb } from "@/lib/db"
import type { AppSession } from "@/lib/session"

interface OwnAccount {
  id: number
  email: string
  auth_method: string
  external_id: string | null
}

function ownAccount(session: AppSession): OwnAccount | undefined {
  const db = getDb()
  const localId = parseLocalAccountUid(session.user?.id)
  if (localId != null) {
    return db.prepare(
      "SELECT id, email, auth_method, external_id FROM accounts WHERE id = ?",
    ).get(localId) as OwnAccount | undefined
  }
  const oid = session.user?.entraOid ?? session.user?.id
  if (!oid) return undefined
  return db.prepare(
    "SELECT id, email, auth_method, external_id FROM accounts WHERE external_id = ?",
  ).get(oid) as OwnAccount | undefined
}

function blocked(account: OwnAccount): string | null {
  if (isLastLocalAdmin(getDb(), account.id)) return LAST_LOCAL_ADMIN_ERROR
  const uid = account.auth_method === "local" ? `local:${account.id}` : account.external_id
  if (uid && getDb().prepare("SELECT id FROM people WHERE account_uid = ? LIMIT 1").get(uid)) {
    return ACCOUNT_STILL_LINKED_ERROR
  }
  return null
}

export async function GET() {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const account = ownAccount(authResult.session)
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const rewrite = accountRemovalRewriteCounts(getDb(), account.email)
  return NextResponse.json({
    email: account.email,
    warning: REMOVAL_WARNING,
    audit_rows: rewrite.audit_rows,
    record_rows: rewrite.record_rows,
    blocked_reason: blocked(account),
  })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult
  if (isDemoModeActive()) {
    return NextResponse.json({ error: DEMO_ACCOUNT_CHANGES_ERROR }, { status: 403 })
  }
  const account = ownAccount(session)
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const reason = blocked(account)
  if (reason) {
    const status = reason === ACCOUNT_STILL_LINKED_ERROR ? 409 : 400
    return NextResponse.json({ error: reason }, { status })
  }

  const db = getDb()
  const localId = parseLocalAccountUid(session.user.id)
  if (localId == null) {
    if (!isEntraAppLockReauthFresh(session.entraAuthTime, Date.now())) {
      return NextResponse.json({ error: SELF_REAUTH_ERROR }, { status: 401 })
    }
  } else {
    let body: { password?: string; otp?: string } = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    if (!body.password) {
      return NextResponse.json({ error: SELF_REAUTH_ERROR }, { status: 401 })
    }
    const proof = await confirmAppLockReauth(db, localId, {
      password: body.password,
      otp: body.otp,
      ip: clientIpFromHeaders(request.headers),
    })
    if (!proof.ok) {
      if (proof.reason === "rate_limited") {
        return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 })
      }
      return NextResponse.json({ error: SELF_REAUTH_ERROR }, { status: 401 })
    }
  }

  try {
    const result = removeAccount(db, account.id, session.user.email ?? null, actorRoleForLog(groups))
    return NextResponse.json({ removed: true, counts: result.counts })
  } catch (err) {
    if (err instanceof AccountRemovalError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }
}
