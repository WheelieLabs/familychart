// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { revokeAuthRevalidation } from "@/lib/auth/auth-revalidation"
import { prunePushSubscriptionsForUserUids } from "@/lib/push/push-subscriptions"

interface Params { params: Promise<{ oid: string }> }

/** Admin-triggered instant revoke — no Graph dependency; takes effect on the user's next request. */
export async function POST(request: NextRequest, { params }: Params) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const { oid } = await params
  if (!oid) return NextResponse.json({ error: "Invalid oid" }, { status: 400 })

  const db = getDb()
  const revoked = revokeAuthRevalidation(db, "entra", oid)
  if (!revoked) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Drop Web Push endpoints/prefs so cron cannot keep delivering PHI after revoke.
  prunePushSubscriptionsForUserUids(db, [oid])

  auditLog(db, session.user?.email, "UPDATE", "auth_revalidation_status", null, {
    provider: "entra",
    external_id: oid,
    action: "revoke",
  })

  return NextResponse.json({ ok: true })
}
