// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireRead, requireAuth, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { rejectDemoProfanity } from "@/lib/demo/demo-profanity-guard"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { deleteObservationGoal, getObservationGoal, setObservationGoal } from "@/lib/observation/observation-goals"
import type { ObservationGoal } from "@/lib/domain-types"

export async function GET(request: NextRequest) {
  const authResult = await requireRead()
  if (authResult instanceof NextResponse) return authResult

  const personIdParam = request.nextUrl.searchParams.get("person_id")
  const observationType = request.nextUrl.searchParams.get("observation_type")
  const personId = personIdParam ? parseInt(personIdParam, 10) : NaN

  if (!Number.isFinite(personId)) {
    return NextResponse.json({ error: "person_id is required" }, { status: 400 })
  }

  const db = getDb()
  const person = authorisePersonAccess(db, authResult, personId, "read")
  if (person instanceof NextResponse) return person

  if (observationType) {
    const goal = getObservationGoal(db, personId, observationType)
    return NextResponse.json(goal ?? null)
  }

  // Return all active goals for this person
  const goals = db
    .prepare("SELECT * FROM observation_goals WHERE person_id = ? AND is_active = 1 ORDER BY observation_type")
    .all(personId) as ObservationGoal[]
  return NextResponse.json(goals)
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult

  const body = await request.json()
  const { person_id, observation_type, goal_type, target_value, target_max, unit, target_date } = body

  if (!person_id || !observation_type || target_value === undefined || !unit) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }
  if (typeof target_value !== "number" || !Number.isFinite(target_value) || target_value <= 0) {
    return NextResponse.json({ error: "target_value must be a positive number" }, { status: 400 })
  }

  const db = getDb()
  const person = authorisePersonAccess(db, authResult, person_id, "write")
  if (person instanceof NextResponse) return person

  const profanity = await rejectDemoProfanity(observation_type, unit)
  if (profanity) return profanity

  const resolvedGoalType = typeof goal_type === "string" ? goal_type : "daily_min"
  const resolvedMax = typeof target_max === "number" && Number.isFinite(target_max) ? target_max : null
  const resolvedDate = typeof target_date === "string" && target_date.trim() ? target_date.trim() : null

  setObservationGoal(db, person_id, observation_type, resolvedGoalType, target_value, resolvedMax, unit, resolvedDate)
  auditLog(db, authResult.session.user?.email, "UPSERT", "observation_goals", null, {
    person_id, observation_type, goal_type: resolvedGoalType, target_value, target_max: resolvedMax, unit, target_date: resolvedDate,
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult

  const personIdParam = request.nextUrl.searchParams.get("person_id")
  const observationType = request.nextUrl.searchParams.get("observation_type")
  const goalType = request.nextUrl.searchParams.get("goal_type")
  const personId = personIdParam ? parseInt(personIdParam, 10) : NaN

  if (!Number.isFinite(personId) || !observationType) {
    return NextResponse.json({ error: "person_id and observation_type are required" }, { status: 400 })
  }

  const db = getDb()
  const person = authorisePersonAccess(db, authResult, personId, "write")
  if (person instanceof NextResponse) return person

  if (goalType) {
    db.prepare(
      `UPDATE observation_goals SET is_active = 0
       WHERE person_id = ? AND observation_type = ? AND goal_type = ?`
    ).run(personId, observationType, goalType)
  } else {
    deleteObservationGoal(db, personId, observationType)
  }
  auditLog(db, authResult.session.user?.email, "DELETE", "observation_goals", null, {
    person_id: personId, observation_type: observationType, goal_type: goalType ?? "all",
  })

  return NextResponse.json({ ok: true })
}
