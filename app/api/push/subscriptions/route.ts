// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/auth-helpers"
import { canonicalAccountUid, watchedPersonIds } from "@/lib/account/account-identity"
import { getDb } from "@/lib/db"

export async function GET() {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const userUid = canonicalAccountUid(session)
  if (!userUid) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const db = getDb()
  const personIds = watchedPersonIds(db, userUid)

  return NextResponse.json(personIds.map(person_id => ({ person_id })))
}
