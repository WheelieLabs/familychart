// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { sessionAccountUids } from "@/lib/account/account-identity"

export async function DELETE(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult

  const linkIds = sessionAccountUids(session.user)
  if (linkIds.length === 0) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const body = await request.json().catch(() => null)
  const { endpoint, person_id } = (body ?? {}) as { endpoint?: string; person_id?: number }

  if (!endpoint && person_id == null) {
    return NextResponse.json({ error: "endpoint or person_id required" }, { status: 400 })
  }

  const db = getDb()
  const uidPlaceholders = linkIds.map(() => "?").join(", ")

  if (person_id != null) {
    db.prepare(
      `DELETE FROM person_notification_prefs WHERE person_id = ? AND user_uid IN (${uidPlaceholders})`
    ).run(person_id, ...linkIds)
  }

  if (endpoint) {
    db.prepare(
      `DELETE FROM push_endpoints WHERE endpoint = ? AND user_uid IN (${uidPlaceholders})`
    ).run(endpoint, ...linkIds)
  }

  return NextResponse.json({ ok: true })
}
