// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { latestBpFromRecentRows } from "@/lib/blood-pressure-pairing"
import { appendRecordedAtRangeFilters } from "@/lib/dashboard/dashboard-schedule-context"
import { hydrationAccountUidForPerson, sessionAccountUids } from "@/lib/account/account-identity"
import { rejectDemoProfanity } from "@/lib/demo/demo-profanity-guard"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { clampHistoryLimit } from "@/lib/api-row-limits"
import { setHydrationLastRecordAt } from "@/lib/hydration/hydration-config"
import { validateRecordTiming } from "@/lib/medication/medication-record-validation"
import { validateObservationWrite } from "@/lib/observation/observation-validation"

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

  if (searchParams.get("summary") === "true") {
    const rows = db.prepare(
      `SELECT o.observation_type,
         MAX(o.recorded_at) as last_recorded,
         COUNT(DISTINCT COALESCE(session_id, 'row:' || id)) as total_count,
         (SELECT o2.value FROM observations o2
          WHERE o2.person_id = o.person_id
            AND o2.observation_type = o.observation_type
          ORDER BY o2.recorded_at DESC LIMIT 1) as latest_value,
         (SELECT o2.unit FROM observations o2
          WHERE o2.person_id = o.person_id
            AND o2.observation_type = o.observation_type
          ORDER BY o2.recorded_at DESC LIMIT 1) as latest_unit
       FROM observations o
       WHERE o.person_id = ?
       GROUP BY o.observation_type
       ORDER BY last_recorded DESC`
    ).all(pid) as Array<{
      observation_type: string
      last_recorded: string
      total_count: number
      latest_value: number | string
      latest_unit: string
    }>

    const bpIdx = rows.findIndex(r => r.observation_type === "Blood Pressure")
    if (bpIdx >= 0) {
      const recent = db.prepare(
        `SELECT id, value, unit, recorded_at, session_id, value_label
         FROM observations
         WHERE person_id = ? AND observation_type = ?
         ORDER BY recorded_at DESC, id DESC
         LIMIT 48`
      ).all(pid, "Blood Pressure") as Parameters<typeof latestBpFromRecentRows>[0]
      const paired = latestBpFromRecentRows(recent)
      if (paired) {
        rows[bpIdx] = {
          ...rows[bpIdx]!,
          latest_value: paired.display,
          latest_unit: paired.latest_unit,
          last_recorded: paired.last_recorded,
        }
      }
    }

    return NextResponse.json(rows)
  }

  const from  = searchParams.get("from")
  const to    = searchParams.get("to")
  const type  = searchParams.get("type")
  const limit = searchParams.get("limit")

  const conditions: string[] = ["person_id = ?"]
  const values: (string | number)[] = [pid]
  appendRecordedAtRangeFilters(request, from, to, conditions, values)
  if (type) { conditions.push("observation_type = ?"); values.push(type) }

  if (searchParams.get("fields") === "chart") {
    return NextResponse.json(db.prepare(
      `SELECT recorded_at, value, unit FROM observations WHERE ${conditions.join(" AND ")} ORDER BY recorded_at DESC, id DESC LIMIT ?`
    ).all(...values, clampHistoryLimit(null)))
  }

  const cursorTs = searchParams.get("cursorTs")
  const cursorId  = searchParams.get("cursorId")

  if (!limit) {
    return NextResponse.json(
      db.prepare(
        `SELECT * FROM observations WHERE ${conditions.join(" AND ")} ORDER BY recorded_at DESC, id DESC LIMIT ?`
      ).all(...values, clampHistoryLimit(null))
    )
  }

  const n = clampHistoryLimit(limit)
  if (cursorTs && cursorId) {
    conditions.push("(recorded_at < ? OR (recorded_at = ? AND id < ?))")
    values.push(cursorTs, cursorTs, parseInt(cursorId, 10))
  }

  const sql = `SELECT * FROM observations WHERE ${conditions.join(" AND ")} ORDER BY recorded_at DESC, id DESC LIMIT ?`
  values.push(n + 1)

  const all = db.prepare(sql).all(...values) as Array<{ recorded_at: string; id: number }>
  const hasMore = all.length > n
  const rows = hasMore ? all.slice(0, n) : all
  const nextCursor = hasMore ? { ts: rows[n - 1].recorded_at, id: rows[n - 1].id } : null
  return NextResponse.json({ rows, nextCursor })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const body = await request.json()
  const { person_id, observation_type, value, unit, recorded_at, comments, session_id, value_label } = body
  if (!person_id || !observation_type || value === undefined || !unit || !recorded_at) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  const db = getDb()
  const person = authorisePersonAccess(db, authResult, person_id, "write")
  if (person instanceof NextResponse) return person

  const profanity = await rejectDemoProfanity(
    observation_type,
    unit,
    typeof comments === "string" ? comments : null,
    typeof value_label === "string" ? value_label : null,
  )
  if (profanity) return profanity

  const validated = validateObservationWrite(db, { observation_type, value })
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  const timing = validateRecordTiming(recorded_at)
  if (!timing.ok) {
    return NextResponse.json({ error: timing.error }, { status: 400 })
  }

  const result = db.prepare(
    `INSERT INTO observations (person_id, observation_type, value, unit, recorded_at, comments, created_by, session_id, value_label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(person_id, validated.observationType, validated.value, unit, timing.recordedAt,
        comments ?? null, session.user?.email ?? null,
        session_id ?? null, value_label ?? null)
  auditLog(db, session.user?.email, "CREATE", "observations",
    Number(result.lastInsertRowid), { person_id, observation_type })

  if (
    observation_type === "Hydration" &&
    person.account_uid &&
    sessionAccountUids(session.user).includes(person.account_uid.trim())
  ) {
    const uid = hydrationAccountUidForPerson(db, { id: person_id, account_uid: person.account_uid })
    if (uid) setHydrationLastRecordAt(db, uid, Date.now())
  }

  return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const id = new URL(request.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  const db = getDb()
  const record = db.prepare(
    "SELECT o.id, o.observation_type, o.value, o.person_id FROM observations o WHERE o.id = ?"
  ).get(parseInt(id, 10)) as {
    id: number
    observation_type: string
    value: number
    person_id: number
  } | undefined
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const person = authorisePersonAccess(db, authResult, record.person_id, "write")
  if (person instanceof NextResponse) return person

  const { recorded_at, value, unit, comments, observation_type } = await request.json()

  const profanity = await rejectDemoProfanity(
    observation_type,
    unit,
    typeof comments === "string" ? comments : null,
  )
  if (profanity) return profanity

  const timing = validateRecordTiming(recorded_at)
  if (!timing.ok) {
    return NextResponse.json({ error: timing.error }, { status: 400 })
  }

  let finalObservationType = record.observation_type

  if (observation_type !== undefined || value !== undefined) {
    const validated = validateObservationWrite(db, {
      observation_type: observation_type ?? record.observation_type,
      value: value ?? record.value,
    })
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }
    finalObservationType = validated.observationType
    db.prepare(
      "UPDATE observations SET recorded_at = ?, value = ?, unit = ?, comments = ?, observation_type = ? WHERE id = ?"
    ).run(
      timing.recordedAt,
      validated.value,
      unit,
      comments ?? null,
      validated.observationType,
      parseInt(id, 10),
    )
  } else {
    db.prepare(
      "UPDATE observations SET recorded_at = ?, value = ?, unit = ?, comments = ? WHERE id = ?"
    ).run(timing.recordedAt, value, unit, comments ?? null, parseInt(id, 10))
  }
  auditLog(db, session.user?.email, "UPDATE", "observations", parseInt(id, 10), {
    person_id: record.person_id,
    observation_type: finalObservationType,
    recorded_at: timing.recordedAt,
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const id = new URL(request.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  const db = getDb()
  const record = db.prepare(
    "SELECT o.id, o.person_id FROM observations o WHERE o.id = ?"
  ).get(parseInt(id, 10)) as { id: number; person_id: number } | undefined
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const person = authorisePersonAccess(db, authResult, record.person_id, "write")
  if (person instanceof NextResponse) return person

  db.prepare("DELETE FROM observations WHERE id = ?").run(parseInt(id, 10))
  auditLog(db, session.user?.email, "DELETE", "observations", parseInt(id, 10), { id: parseInt(id, 10) })
  return NextResponse.json({ ok: true })
}
