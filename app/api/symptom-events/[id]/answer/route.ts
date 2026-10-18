// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { resolveCalendarContext } from "@/lib/calendar-context"
import { answerOpenSymptom, getSymptomOwner, type OpenSymptomAnswer } from "@/lib/symptoms/open-symptom-prompts"

interface Params {
  params: Promise<{ id: string }>
}

/**
 * Inline answer to the daily "still ongoing or resolved?" question on an Open symptom.
 * Body: `{ outcome: "ongoing" }` or `{ outcome: "resolved", resolved_ymd?: "YYYY-MM-DD" }` (an earlier
 * day than today is the "Resolved earlier" choice). Needs write access to the symptom's Person.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const { id } = await params
  const symptomId = parseInt(id, 10)
  if (!Number.isFinite(symptomId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const db = getDb()
  const owner = getSymptomOwner(db, symptomId)
  if (!owner) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const person = authorisePersonAccess(db, authResult, owner.personId, "write")
  if (person instanceof NextResponse) return person

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let answer: OpenSymptomAnswer
  if (body.outcome === "ongoing") {
    answer = { outcome: "ongoing" }
  } else if (body.outcome === "resolved") {
    if (body.resolved_ymd !== undefined && typeof body.resolved_ymd !== "string") {
      return NextResponse.json({ error: "resolved_ymd must be a date (YYYY-MM-DD)" }, { status: 400 })
    }
    answer = { outcome: "resolved", resolvedYmd: body.resolved_ymd }
  } else {
    return NextResponse.json({ error: "outcome must be ongoing or resolved" }, { status: 400 })
  }

  const today = resolveCalendarContext(db, null, Date.now(), request)
  if (!today) return NextResponse.json({ error: "Could not work out the local day" }, { status: 400 })

  const result = answerOpenSymptom(db, { symptomId, answer, today })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  auditLog(db, session.user?.email, "UPDATE", "symptom_events", symptomId, {
    person_id: result.personId,
    answer: result.outcome,
    ...(answer.outcome === "resolved" ? { resolved_ymd: answer.resolvedYmd ?? today.ymd } : { local_ymd: today.ymd }),
  })

  return NextResponse.json({ outcome: result.outcome })
}
