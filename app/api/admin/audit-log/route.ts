// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { listAuditLogFacets, parseAuditLogQuery, queryAuditLog } from "@/lib/audit-log-query"

export async function GET(request: NextRequest) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult

  const parsed = parseAuditLogQuery(request.nextUrl.searchParams)
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const db = getDb()
  const page = queryAuditLog(db, parsed)
  const facets = listAuditLogFacets(db)
  return NextResponse.json({ ...page, ...facets })
}
