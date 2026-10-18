// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"

/**
 * Distinct symptom labels this person has previously been recorded with — powers the
 * record-symptom autocomplete. Person-scoped, not a global catalogue: unlike medication names,
 * symptom labels have no shared catalogue to source from.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult

  const { searchParams } = new URL(request.url)
  const personId = searchParams.get("person_id")
  if (!personId) return NextResponse.json({ error: "person_id is required" }, { status: 400 })

  const db = getDb()
  const pid = parseInt(personId, 10)
  const person = authorisePersonAccess(db, authResult, pid, "read")
  if (person instanceof NextResponse) return person

  const rows = db.prepare(
    "SELECT DISTINCT label FROM symptom_events WHERE person_id = ? ORDER BY label COLLATE NOCASE"
  ).all(pid) as { label: string }[]

  return NextResponse.json(rows.map(r => r.label))
}
