// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { isDemoModeActive } from "@/lib/demo/demo-mode"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import type { Account } from "@/lib/domain-types"
import { bumpLocalUserSessionVersion } from "@/lib/local-user-session"
import { prunePushSubscriptionsForUserUids } from "@/lib/push/push-subscriptions"
import { formatLocalAccountUid } from "@/lib/account/account-uid"
import { VALID_ROLES } from "@/lib/account/account-roles"

interface Params { params: Promise<{ id: string }> }

export async function PUT(request: NextRequest, { params }: Params) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult
  if (isDemoModeActive())
    return NextResponse.json({ error: "This is a demo environment — account changes are disabled." }, { status: 403 })

  const { id } = await params
  const numId = parseInt(id, 10)
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const body = await request.json()
  const role = typeof body.role === "string" ? body.role : undefined
  const can_report   = body.can_report !== undefined ? (body.can_report ? 1 : 0) : undefined
  const is_active    = body.is_active !== undefined ? (body.is_active ? 1 : 0) : undefined
  const clear_mfa    = body.clear_mfa === true

  if (role !== undefined && !VALID_ROLES.has(role))
    return NextResponse.json({ error: "Invalid role" }, { status: 400 })

  const db = getDb()
  const existing = db
    .prepare("SELECT id, is_active, auth_method FROM accounts WHERE id = ?")
    .get(numId) as { id: number; is_active: number; auth_method: string } | undefined
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (existing.auth_method === "entra" && role !== undefined) {
    return NextResponse.json(
      { error: "This account's access level comes from Entra group membership" },
      { status: 400 },
    )
  }

  if (clear_mfa) {
    db.prepare(
      `UPDATE accounts SET totp_secret = NULL, totp_secret_pending = NULL WHERE id = ?`
    ).run(numId)
  }

  db.prepare(
    "UPDATE accounts SET role = COALESCE(?, role), can_report = COALESCE(?, can_report), is_active = COALESCE(?, is_active) WHERE id = ?"
  ).run(role ?? null, can_report ?? null, is_active ?? null, numId)

  const after = db
    .prepare("SELECT is_active FROM accounts WHERE id = ?")
    .get(numId) as { is_active: number } | undefined
  if (after && !after.is_active) {
    prunePushSubscriptionsForUserUids(db, [formatLocalAccountUid(numId)])
  }

  if (role !== undefined || can_report !== undefined || is_active !== undefined || clear_mfa) {
    bumpLocalUserSessionVersion(db, numId)
  }

  auditLog(db, session.user?.email, "UPDATE", "accounts", numId, {
    role,
    can_report,
    is_active,
    ...(clear_mfa ? { clear_mfa: true } : {}),
  })

  const updated = db.prepare(
    "SELECT id, email, role, can_report, is_active, created_at FROM accounts WHERE id = ?"
  ).get(numId) as Omit<Account, "password_hash">

  return NextResponse.json(updated)
}
