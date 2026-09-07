// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { isDemoModeActive } from "@/lib/demo/demo-mode"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { revokeInvite } from "@/lib/invite"

interface Params { params: Promise<{ id: string }> }

/**
 * Revoke a pending invite: sets invite_revoked_at, never touches role or people.account_uid
 * (per spec — resend is designed to "just work" on the same row, so nothing about the
 * invite's original role/person-link decision is unwound here).
 */
export async function POST(_request: NextRequest, { params }: Params) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult
  if (isDemoModeActive())
    return NextResponse.json({ error: "This is a demo environment — account changes are disabled." }, { status: 403 })

  const { id } = await params
  const accountId = parseInt(id, 10)
  if (!Number.isFinite(accountId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const db = getDb()
  if (!revokeInvite(db, accountId)) {
    return NextResponse.json({ error: "No pending invite to revoke" }, { status: 409 })
  }

  auditLog(db, session.user?.email, "UPDATE", "accounts", accountId, { invite_revoked: true })

  return NextResponse.json({ ok: true })
}
