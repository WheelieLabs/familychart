// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { appendRecordedAtRangeFilters } from "@/lib/dashboard/dashboard-schedule-context"
import { listSeries, querySeriesPoints } from "@/lib/test-results/test-metric-series"

/**
 * Chart data for the test metric chart. Without `metric` it lists the Person's chartable series
 * and panels; with `metric` (and optional `unit`, `from`, `to`) it returns that series' points.
 * Same read check as `GET /api/test-events`.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult

  const { searchParams } = new URL(request.url)
  const personId = searchParams.get("person_id")
  if (!personId) return NextResponse.json({ error: "person_id is required" }, { status: 400 })

  const db = getDb()
  const person = authorisePersonAccess(db, authResult, parseInt(personId, 10), "read")
  if (person instanceof NextResponse) return person

  const metric = searchParams.get("metric")
  if (!metric) return NextResponse.json(listSeries(db, person.id))

  const conditions: string[] = []
  const values: (string | number)[] = []
  appendRecordedAtRangeFilters(request, db, searchParams.get("from"), searchParams.get("to"), conditions, values, "e.date")

  const unit = searchParams.get("unit")
  return NextResponse.json(
    querySeriesPoints(db, person.id, metric, unit && unit.trim() !== "" ? unit : null, conditions, values),
  )
}
