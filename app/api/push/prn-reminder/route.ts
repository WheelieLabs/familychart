// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { getApplicableFrequencyRule, getLatestPersonWeightKg } from "@/lib/frequency-rule"
import { fractionalAgeYears } from "@/lib/person/person-age"
import { resolveAgeTimezone } from "@/lib/instance-timezone"
import { resolvePrnRemindAfterHours } from "@/lib/prn/prn-remind-hours"

export async function POST(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult

  const body = await request.json().catch(() => null)
  const medication_record_id = body?.medication_record_id
  if (!medication_record_id || typeof medication_record_id !== "number") {
    return NextResponse.json({ error: "medication_record_id required" }, { status: 400 })
  }

  const db = getDb()
  const record = db.prepare(
    `SELECT mr.id, mr.person_id, mr.medication_id, p.date_of_birth
     FROM medication_records mr
     JOIN people p ON p.id = mr.person_id
     WHERE mr.id = ?`
  ).get(medication_record_id) as {
    id: number
    person_id: number
    medication_id: number
    date_of_birth: string | null
  } | undefined

  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const person = authorisePersonAccess(db, authResult, record.person_id, "write")
  if (person instanceof NextResponse) return person

  const personAge =
    record.date_of_birth != null ? fractionalAgeYears(record.date_of_birth, resolveAgeTimezone(db)) : null
  const weightKg = getLatestPersonWeightKg(db, record.person_id)
  const rule = getApplicableFrequencyRule(db, record.medication_id, personAge, weightKg)
  const minHours = rule?.min_hours_between ?? 0
  const maxHours = rule?.max_hours_between ?? null

  const resolved = resolvePrnRemindAfterHours(body?.remind_after_hours, minHours, maxHours)
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 400 })
  }

  db.prepare(
    "INSERT OR IGNORE INTO prn_push_requests (medication_record_id, remind_after_hours) VALUES (?, ?)"
  ).run(medication_record_id, resolved.hours)

  return NextResponse.json({ ok: true })
}
