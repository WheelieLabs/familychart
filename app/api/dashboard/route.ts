// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireRead } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import type { Person } from "@/lib/domain-types"
import type { DashboardPersonStatus } from "@/lib/dashboard/dashboard-status"
import { evaluateDashboardPersonStatus } from "@/lib/dashboard/dashboard-person-status"
import { canReadForPerson } from "@/lib/permissions"
import { parseClientNow, resolveCalendarContext } from "@/lib/calendar-context"

export async function GET(request: NextRequest) {
  const authResult = await requireRead()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult

  const db = getDb()

  const allPeople = db
    .prepare("SELECT * FROM people WHERE is_active = 1 ORDER BY sort_order, name")
    .all() as Person[]

  const people = allPeople.filter(p => canReadForPerson(groups, session.user, p.account_uid))
  if (people.length === 0) return NextResponse.json([] satisfies DashboardPersonStatus[])

  const now = parseClientNow(request)
  const calCtx = resolveCalendarContext(db, null, now.getTime(), request)!

  const out = evaluateDashboardPersonStatus(db, people, { now, calCtx })

  return NextResponse.json(out satisfies DashboardPersonStatus[], {
    headers: { "Cache-Control": "no-store" },
  })
}
