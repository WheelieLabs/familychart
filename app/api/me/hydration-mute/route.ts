// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/auth-helpers"
import { linkedPersonAccountUid } from "@/lib/account/account-identity"
import { getDb } from "@/lib/db"
import { setHydrationMutedForLocalDay } from "@/lib/hydration/hydration-config"
import { resolveHydrationLocalDay } from "@/lib/hydration/hydration-timezone"

export async function POST() {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const db = getDb()
  const userUid = linkedPersonAccountUid(db, session)
  if (!userUid) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const localDay = resolveHydrationLocalDay(db, userUid, Date.now())
  if (!localDay?.ymd) {
    return NextResponse.json({ error: "Could not resolve hydration timezone" }, { status: 400 })
  }

  setHydrationMutedForLocalDay(db, userUid, localDay.ymd, {
    actorEmail: session.user?.email,
  })
  return NextResponse.json({ ok: true, muted_until: localDay.ymd })
}
