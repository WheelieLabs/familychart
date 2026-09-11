// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/auth-helpers"
import {
  findPersonalLinkPerson,
  hydrationSettingsCandidateUids,
  linkedPersonAccountUid,
} from "@/lib/account/account-identity"
import { getDb } from "@/lib/db"
import {
  getUserHydrationTimezone,
  getUserHydrationTimezoneForCandidateUids,
  resolveHydrationTimezone,
  setUserHydrationTimezone,
} from "@/lib/hydration/hydration-timezone"

export async function GET() {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult
  const db = getDb()
  const userUid = linkedPersonAccountUid(db, session)
  if (!userUid) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const person = findPersonalLinkPerson(db, session)
  const timezone = person
    ? getUserHydrationTimezoneForCandidateUids(
        db,
        userUid,
        hydrationSettingsCandidateUids(db, person, session),
      )
    : getUserHydrationTimezone(db, userUid)
  const effective = resolveHydrationTimezone(db, { userUid, userTz: timezone })
  return NextResponse.json({ timezone, effective })
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult
  const db = getDb()
  const userUid = linkedPersonAccountUid(db, session)
  if (!userUid) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  let body: { timezone?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!("timezone" in body)) {
    return NextResponse.json({ error: "timezone is required" }, { status: 400 })
  }

  const raw = body.timezone
  if (raw != null && typeof raw !== "string") {
    return NextResponse.json({ error: "timezone must be a string or null" }, { status: 400 })
  }

  try {
    setUserHydrationTimezone(db, userUid, raw ?? null, {
      actorEmail: session.user?.email,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not save timezone"
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const timezone = getUserHydrationTimezone(db, userUid)
  const effective = resolveHydrationTimezone(db, { userUid, userTz: timezone })
  return NextResponse.json({ timezone, effective })
}
