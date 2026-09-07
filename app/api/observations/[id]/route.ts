// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { rejectDemoProfanity } from "@/lib/demo/demo-profanity-guard"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import type { Observation } from "@/lib/domain-types"
import { validateRecordTiming } from "@/lib/medication/medication-record-validation"
import { validateObservationWrite } from "@/lib/observation/observation-validation"

interface Params {
  params: Promise<{ id: string }>
}

export async function PUT(request: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const idParam = (await params).id
  const id = parseInt(idParam, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const db = getDb()
  const record = db.prepare(
    `SELECT o.id, o.person_id, o.observation_type, o.session_id, o.value_label
       FROM observations o
      WHERE o.id = ?`
  ).get(id) as {
    id: number
    person_id: number
    observation_type: string
    session_id: string | null
    value_label: string | null
  } | undefined
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const person = authorisePersonAccess(db, authResult, record.person_id, "write")
  if (person instanceof NextResponse) return person

  const body = await request.json()
  const { recorded_at, value, unit, comments } = body
  if (value === undefined || !unit || !recorded_at) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  const profanity = await rejectDemoProfanity(
    unit,
    typeof comments === "string" ? comments : null,
  )
  if (profanity) return profanity

  const validated = validateObservationWrite(db, {
    observation_type: record.observation_type,
    value,
  })
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  const timing = validateRecordTiming(recorded_at)
  if (!timing.ok) {
    return NextResponse.json({ error: timing.error }, { status: 400 })
  }

  db.prepare(
    `UPDATE observations SET recorded_at = ?, value = ?, unit = ?, comments = ? WHERE id = ?`
  ).run(timing.recordedAt, validated.value, unit, comments ?? null, id)

  auditLog(db, session.user?.email, "UPDATE", "observations", id, {
    person_id: record.person_id,
    observation_type: record.observation_type,
    recorded_at: timing.recordedAt,
  })

  const updated = db.prepare("SELECT * FROM observations WHERE id = ?").get(id) as Observation
  return NextResponse.json(updated)
}
