// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { isOwnAccount } from "@/lib/account/own-account"
import {
  ACCOUNT_STILL_LINKED_ERROR,
  AccountRemovalError,
  accountRemovalRewriteCounts,
  CONFIRM_EMAIL_ERROR,
  DEMO_ACCOUNT_CHANGES_ERROR,
  OWN_ACCOUNT_ADMIN_ERROR,
  removeAccount,
} from "@/lib/account/remove-account"
import { isLastLocalAdmin, LAST_LOCAL_ADMIN_ERROR } from "@/lib/account/last-local-admin"
import { actorRoleForLog } from "@/lib/data-event-log"
import { isDemoModeActive } from "@/lib/demo/demo-mode"
import { REMOVAL_WARNING } from "@/lib/account/account-removal-messages"
import { getDb } from "@/lib/db"

interface Params { params: Promise<{ id: string }> }

const DELETED = [
  "The account, its password and any password-reset requirement",
  "The authenticator secret",
  "Sessions, so they are signed out immediately",
  "Invite tokens",
  "Push subscriptions",
  "Favourites",
  "Settings saved for this account",
  "The Personal-link, when one remains",
  "Notification history for this account",
  "The Entra revalidation row, when this account signs in with Microsoft",
]

interface AccountGate {
  id: number
  email: string
  auth_method: string
  external_id: string | null
}

function loadAccount(id: string): AccountGate | NextResponse {
  const numId = parseInt(id, 10)
  if (!Number.isFinite(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  const row = getDb()
    .prepare("SELECT id, email, auth_method, external_id FROM accounts WHERE id = ?")
    .get(numId) as AccountGate | undefined
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return row
}

function blockedReason(account: AccountGate, sessionUserId: string | undefined): string | null {
  if (isOwnAccount(sessionUserId, account)) return OWN_ACCOUNT_ADMIN_ERROR
  if (isLastLocalAdmin(getDb(), account.id)) return LAST_LOCAL_ADMIN_ERROR
  const uid = account.auth_method === "local"
    ? `local:${account.id}`
    : account.external_id
  if (uid && getDb().prepare("SELECT id FROM people WHERE account_uid = ? LIMIT 1").get(uid)) {
    return ACCOUNT_STILL_LINKED_ERROR
  }
  return null
}

/** Counts and the warning for the confirmation dialog. Does not remove anything. */
export async function GET(_request: NextRequest, { params }: Params) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  const { id } = await params
  const account = loadAccount(id)
  if (account instanceof NextResponse) return account
  const db = getDb()
  const rewrite = accountRemovalRewriteCounts(db, account.email)
  return NextResponse.json({
    email: account.email,
    deleted: DELETED,
    warning: REMOVAL_WARNING,
    audit_rows: rewrite.audit_rows,
    record_rows: rewrite.record_rows,
    blocked_reason: blockedReason(account, authResult.session.user.id),
  })
}

/** An Admin removes another Account after typing its email. */
export async function POST(request: NextRequest, { params }: Params) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult
  if (isDemoModeActive()) {
    return NextResponse.json({ error: DEMO_ACCOUNT_CHANGES_ERROR }, { status: 403 })
  }
  const { id } = await params
  const account = loadAccount(id)
  if (account instanceof NextResponse) return account

  const blocked = blockedReason(account, session.user.id)
  if (blocked) {
    const status = blocked === ACCOUNT_STILL_LINKED_ERROR ? 409 : 400
    return NextResponse.json({ error: blocked }, { status })
  }

  let body: { email?: unknown } = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const typed = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
  if (typed !== account.email.trim().toLowerCase()) {
    return NextResponse.json({ error: CONFIRM_EMAIL_ERROR }, { status: 400 })
  }

  try {
    const result = removeAccount(getDb(), account.id, session.user.email ?? null, actorRoleForLog(groups))
    return NextResponse.json({ removed: true, counts: result.counts })
  } catch (err) {
    if (err instanceof AccountRemovalError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }
}
