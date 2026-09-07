// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireRead, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { getTodayHydrationTotal } from "@/lib/hydration/hydration-evaluate"
import { getObservationGoal } from "@/lib/observation/observation-goals"
import { resolveCalendarContext } from "@/lib/calendar-context"
import { addCalendarDaysToIsoYmd, localCalendarYmdHmToUtcMs } from "@/lib/datetime"

export async function GET(request: NextRequest) {
  const authResult = await requireRead()
  if (authResult instanceof NextResponse) return authResult
  const personIdParam = request.nextUrl.searchParams.get("person_id")
  const personId = personIdParam ? parseInt(personIdParam, 10) : NaN
  if (!Number.isFinite(personId)) {
    return NextResponse.json({ error: "person_id is required" }, { status: 400 })
  }

  const db = getDb()
  const person = authorisePersonAccess(db, authResult, personId, "read")
  if (person instanceof NextResponse) return person

  const { ymd: localTodayYmd, offsetMinutes: tzOffsetMinutes } = resolveCalendarContext(db, null, Date.now(), request)!
  const startUtc = new Date(localCalendarYmdHmToUtcMs(localTodayYmd, "00:00", tzOffsetMinutes)).toISOString()
  const nextYmd  = addCalendarDaysToIsoYmd(localTodayYmd, 1)
  const endUtc   = new Date(localCalendarYmdHmToUtcMs(nextYmd, "00:00", tzOffsetMinutes)).toISOString()
  const { total_ml } = getTodayHydrationTotal(db, personId, startUtc, endUtc)
  const goal = getObservationGoal(db, personId, "Hydration")

  return NextResponse.json({
    total_ml,
    goal_ml: goal ? goal.target_value : null,
  })
}
