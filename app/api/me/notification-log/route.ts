// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/auth-helpers"
import { canonicalAccountUid } from "@/lib/account/account-identity"
import { getDb } from "@/lib/db"
import { getNotificationLogForUser } from "@/lib/push"

export async function GET(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const userUid = canonicalAccountUid(session)
  if (!userUid) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const { searchParams } = request.nextUrl
  const limitRaw = searchParams.get("limit")
  const limit = limitRaw ? parseInt(limitRaw, 10) : 20
  if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
    return NextResponse.json({ error: "Invalid limit" }, { status: 400 })
  }

  const cursorTs = searchParams.get("cursorTs")
  const cursorIdRaw = searchParams.get("cursorId")
  let cursor: { ts: string; id: number } | null = null
  if (cursorTs && cursorIdRaw) {
    const id = parseInt(cursorIdRaw, 10)
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 })
    }
    cursor = { ts: cursorTs, id }
  }

  const result = getNotificationLogForUser(getDb(), userUid, { limit, cursor })
  return NextResponse.json(result)
}
