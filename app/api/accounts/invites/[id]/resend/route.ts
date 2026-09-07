// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { isDemoModeActive } from "@/lib/demo/demo-mode"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { isOutboundEmailConfigured, sendOutboundEmail } from "@/lib/email-send"
import { commitInviteResend, prepareInviteResend } from "@/lib/invite"
import { publicOrigin } from "@/lib/reverse-proxy"

interface Params { params: Promise<{ id: string }> }

/**
 * Re-issue a pending invite: fresh token, expiry reset to +7 days, invite_revoked_at cleared
 * if set. Never touches role or people.account_uid — identical whether the invite was
 * previously expired or explicitly revoked, per spec.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult
  if (isDemoModeActive())
    return NextResponse.json({ error: "This is a demo environment — account changes are disabled." }, { status: 403 })

  const { id } = await params
  const accountId = parseInt(id, 10)
  if (!Number.isFinite(accountId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const db = getDb()
  if (!isOutboundEmailConfigured(db)) {
    return NextResponse.json(
      { error: "Outbound email is not configured on this instance" },
      { status: 400 },
    )
  }

  const prepared = prepareInviteResend(db, accountId, {
    origin: publicOrigin(request.headers, request.nextUrl.origin),
    inviter: session.user ?? {},
  })
  if (!prepared.ok) {
    return NextResponse.json({ error: "No pending invite to resend" }, { status: 409 })
  }

  // Send with the new token *before* persisting it: the old token may still be live (an
  // admin can resend an unexpired invite too), so a delivery failure here must not strand
  // the invitee with neither a working old link nor a delivered new one.
  const emailResult = await sendOutboundEmail(db, prepared.draft.mail)
  if (!emailResult.ok) {
    return NextResponse.json({ error: emailResult.error }, { status: 502 })
  }

  commitInviteResend(db, prepared.draft)

  auditLog(db, session.user?.email, "UPDATE", "accounts", accountId, { invite_resent: true })

  return NextResponse.json({ ok: true })
}
