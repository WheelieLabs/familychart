// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRead, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { parseScheduleTimesJson } from "@/lib/schedule/schedule-recurrence"
import { validateDoseExpectationInput } from "@/lib/schedule/dose-expectation-input"
import { parseWeekdaysJson } from "@/lib/schedule/dose-expectation-store"

interface Params {
  params: Promise<{ id: string }>
}

/** Recent outcomes shown beside each expectation so a confirmed miss stays visible as history. */
const RECENT_OUTCOMES = 20

export async function GET(_req: NextRequest, { params }: Params) {
  const authResult = await requireRead()
  if (authResult instanceof NextResponse) return authResult

  const { id } = await params
  const personId = parseInt(id, 10)
  if (!Number.isFinite(personId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const db = getDb()
  const person = authorisePersonAccess(db, authResult, personId, "read")
  if (person instanceof NextResponse) return person

  const rows = db
    .prepare(
      `SELECT de.id, de.person_medication_id, pm.medication_id, m.name AS medication_name,
              de.slot_hhmm, de.start_date, de.end_date, de.weekdays
         FROM dose_expectations de
         JOIN person_medications pm ON pm.id = de.person_medication_id
         JOIN medications m ON m.id = pm.medication_id
        WHERE pm.person_id = ?
        ORDER BY m.name COLLATE NOCASE, de.slot_hhmm, de.start_date`,
    )
    .all(personId) as {
    id: number
    person_medication_id: number
    medication_id: number
    medication_name: string
    slot_hhmm: string
    start_date: string
    end_date: string
    weekdays: string | null
  }[]

  const exceptionStmt = db.prepare(
    "SELECT local_ymd FROM dose_expectation_exceptions WHERE dose_expectation_id = ? ORDER BY local_ymd",
  )
  const outcomeStmt = db.prepare(
    `SELECT local_ymd, status FROM dose_expectation_outcomes
      WHERE dose_expectation_id = ? AND status != 'snoozed'
      ORDER BY local_ymd DESC LIMIT ${RECENT_OUTCOMES}`,
  )

  return NextResponse.json(
    rows.map(r => ({
      ...r,
      weekdays: parseWeekdaysJson(r.weekdays),
      exceptions: (exceptionStmt.all(r.id) as { local_ymd: string }[]).map(e => e.local_ymd),
      outcomes: outcomeStmt.all(r.id),
    })),
  )
}

export async function POST(request: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const { id } = await params
  const personId = parseInt(id, 10)
  if (!Number.isFinite(personId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const db = getDb()
  const person = authorisePersonAccess(db, authResult, personId, "write")
  if (person instanceof NextResponse) return person

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const pmId = typeof body.person_medication_id === "number" ? body.person_medication_id : NaN
  const pm = Number.isFinite(pmId)
    ? (db
        .prepare(
          "SELECT id, schedule_times FROM person_medications WHERE id = ? AND person_id = ? AND is_active = 1",
        )
        .get(pmId, personId) as { id: number; schedule_times: string | null } | undefined)
    : undefined
  if (!pm) return NextResponse.json({ error: "Scheduled medication not found" }, { status: 404 })

  const validated = validateDoseExpectationInput(body, parseScheduleTimesJson(pm.schedule_times))
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })
  const v = validated.value

  const result = db
    .prepare(
      `INSERT INTO dose_expectations (person_medication_id, slot_hhmm, start_date, end_date, weekdays, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(pm.id, v.slotHhmm, v.startDate, v.endDate, v.weekdays ? JSON.stringify(v.weekdays) : null, session.user?.email ?? null)
  const newId = Number(result.lastInsertRowid)
  auditLog(db, session.user?.email, "CREATE", "dose_expectations", newId, {
    person_id: personId,
    person_medication_id: pm.id,
    slot: v.slotHhmm,
  })

  return NextResponse.json({ id: newId }, { status: 201 })
}
