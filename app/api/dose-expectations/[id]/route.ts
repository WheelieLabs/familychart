// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { parseScheduleTimesJson } from "@/lib/schedule/schedule-recurrence"
import { validateDoseExpectationInput } from "@/lib/schedule/dose-expectation-input"
import { getDoseExpectationOwner } from "@/lib/schedule/dose-expectation-store"

interface Params {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const { id } = await params
  const expectationId = parseInt(id, 10)
  if (!Number.isFinite(expectationId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const db = getDb()
  const owner = getDoseExpectationOwner(db, expectationId)
  if (!owner) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const person = authorisePersonAccess(db, authResult, owner.personId, "write")
  if (person instanceof NextResponse) return person

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Full-replace of the editable fields, validated against the schedule as it stands now.
  const validated = validateDoseExpectationInput(body, parseScheduleTimesJson(owner.scheduleTimes))
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })
  const v = validated.value

  db.prepare(
    "UPDATE dose_expectations SET slot_hhmm = ?, start_date = ?, end_date = ?, weekdays = ? WHERE id = ?",
  ).run(v.slotHhmm, v.startDate, v.endDate, v.weekdays ? JSON.stringify(v.weekdays) : null, expectationId)
  auditLog(db, session.user?.email, "UPDATE", "dose_expectations", expectationId, { person_id: owner.personId })

  return NextResponse.json({ id: expectationId })
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const { id } = await params
  const expectationId = parseInt(id, 10)
  if (!Number.isFinite(expectationId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const db = getDb()
  const owner = getDoseExpectationOwner(db, expectationId)
  if (!owner) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const person = authorisePersonAccess(db, authResult, owner.personId, "write")
  if (person instanceof NextResponse) return person

  db.prepare("DELETE FROM dose_expectations WHERE id = ?").run(expectationId)
  auditLog(db, session.user?.email, "DELETE", "dose_expectations", expectationId, { person_id: owner.personId })

  return NextResponse.json({ ok: true })
}
