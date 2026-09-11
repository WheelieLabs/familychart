// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@/lib/logger"

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRead, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import type Database from "better-sqlite3-multiple-ciphers"
import { parseClientNow, resolveCalendarContext } from "@/lib/calendar-context"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import type { Person } from "@/lib/domain-types"
import {
  mergeExpectationPatch,
  validateObservationExpectation,
} from "@/lib/observation/observation-expectation-validation"
import {
  enrichSingleExpectation,
  listEnrichedExpectationsForPerson,
} from "@/lib/observation/observation-schedule"
import type { ObservationScheduleContext, PersonObservationExpectationRow } from "@/lib/observation/observation-recurrence"

interface Params {
  params: Promise<{ id: string }>
}

function resolveObservationContext(
  db: Database.Database,
  request: NextRequest,
): { sched: ObservationScheduleContext; instanceIanaTz: string | null } {
  const now = parseClientNow(request)
  const calCtx = resolveCalendarContext(db, null, now.getTime(), request)!
  const sched: ObservationScheduleContext = {
    now,
    tzOffsetMinutes: calCtx.offsetMinutes,
    localTodayYmd: calCtx.ymd,
  }
  return { sched, instanceIanaTz: calCtx.ianaTz }
}

export async function GET(request: NextRequest, { params }: Params) {
  const authResult = await requireRead()
  if (authResult instanceof NextResponse) return authResult

  const { id } = await params
  const personId = parseInt(id, 10)
  const db = getDb()
  const person = authorisePersonAccess(db, authResult, personId, "read")
  if (person instanceof NextResponse) return person

  const { sched, instanceIanaTz } = resolveObservationContext(db, request)
  const expectations = listEnrichedExpectationsForPerson(db, personId, person, sched, instanceIanaTz)

  return NextResponse.json({
    person_id: personId,
    date_of_birth: person.date_of_birth,
    expectations,
  })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const { id } = await params
  const personId = parseInt(id, 10)
  const db = getDb()
  const person = authorisePersonAccess(db, authResult, personId, "write")
  if (person instanceof NextResponse) return person

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const b = body as { expectations?: unknown }
  if (!Array.isArray(b.expectations)) {
    return NextResponse.json({ error: "expectations array required" }, { status: 400 })
  }

  const parsed: Omit<PersonObservationExpectationRow, "id">[] = []
  const seenTypes = new Set<string>()
  for (const item of b.expectations) {
    if (typeof item !== "object" || item === null) {
      return NextResponse.json({ error: "Invalid expectation row" }, { status: 400 })
    }
    const result = validateObservationExpectation(
      db,
      item as Record<string, unknown>,
      person.date_of_birth,
    )
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    if (seenTypes.has(result.row.observation_type)) {
      return NextResponse.json(
        { error: `Duplicate Observation Type: ${result.row.observation_type}` },
        { status: 400 },
      )
    }
    seenTypes.add(result.row.observation_type)
    parsed.push({ person_id: personId, ...result.row })
  }

  const insert = db.prepare(
    `INSERT INTO person_observation_expectations
      (person_id, observation_type, cadence, interval_days, recurrence_day_of_month, recurrence_month, recurrence_day, recurrence_use_birthday, enabled, due_time_hhmm, tz)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM person_observation_expectations WHERE person_id = ?").run(personId)
    for (const p of parsed) {
      insert.run(
        personId,
        p.observation_type,
        p.cadence,
        p.interval_days,
        p.recurrence_day_of_month,
        p.recurrence_month,
        p.recurrence_day,
        p.recurrence_use_birthday,
        p.enabled,
        p.due_time_hhmm,
        p.tz,
      )
    }
  })

  tx()
  auditLog(db, session.user?.email, "UPDATE", "person_observation_expectations", personId, {
    count: parsed.length,
  })

  const { sched, instanceIanaTz } = resolveObservationContext(db, request)
  const expectations = listEnrichedExpectationsForPerson(db, personId, person, sched, instanceIanaTz)

  return NextResponse.json({
    person_id: personId,
    date_of_birth: person.date_of_birth,
    expectations,
  })
}

export async function POST(request: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const { id } = await params
  const personId = parseInt(id, 10)
  const db = getDb()
  const person = authorisePersonAccess(db, authResult, personId, "write")
  if (person instanceof NextResponse) return person

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const result = validateObservationExpectation(db, body, person.date_of_birth)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  const parsed: Omit<PersonObservationExpectationRow, "id"> = {
    person_id: personId,
    ...result.row,
  }

  const dup = db
    .prepare(
      `SELECT id FROM person_observation_expectations
        WHERE person_id = ? AND observation_type = ? COLLATE NOCASE`,
    )
    .get(personId, parsed.observation_type) as { id: number } | undefined
  if (dup) {
    return NextResponse.json(
      { error: "Observation Type already exists for this person" },
      { status: 400 },
    )
  }

  const insert = db.prepare(
    `INSERT INTO person_observation_expectations
      (person_id, observation_type, cadence, interval_days, recurrence_day_of_month, recurrence_month, recurrence_day, recurrence_use_birthday, enabled, due_time_hhmm, tz)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  let newId: number
  try {
    const insertResult = insert.run(
      personId,
      parsed.observation_type,
      parsed.cadence,
      parsed.interval_days,
      parsed.recurrence_day_of_month,
      parsed.recurrence_month,
      parsed.recurrence_day,
      parsed.recurrence_use_birthday,
      parsed.enabled,
      parsed.due_time_hhmm,
      parsed.tz,
    )
    newId = Number(insertResult.lastInsertRowid)
  } catch (e) {
    logger.error("[observation-expectations POST]", e)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  auditLog(db, session.user?.email, "CREATE", "person_observation_expectations", newId, {
    person_id: personId,
    observation_type: parsed.observation_type,
  })

  const row = db
    .prepare("SELECT * FROM person_observation_expectations WHERE id = ?")
    .get(newId) as PersonObservationExpectationRow

  const { sched, instanceIanaTz } = resolveObservationContext(db, request)
  return NextResponse.json({ expectation: enrichSingleExpectation(db, person, row, sched, instanceIanaTz) }, { status: 201 })
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const { id } = await params
  const personId = parseInt(id, 10)
  const expIdRaw = new URL(request.url).searchParams.get("id")
  const expId = expIdRaw ? parseInt(expIdRaw, 10) : NaN
  if (!Number.isFinite(expId)) {
    return NextResponse.json({ error: "id query parameter is required" }, { status: 400 })
  }

  const db = getDb()
  const person = authorisePersonAccess(db, authResult, personId, "write")
  if (person instanceof NextResponse) return person

  const existing = db
    .prepare("SELECT * FROM person_observation_expectations WHERE id = ? AND person_id = ?")
    .get(expId, personId) as PersonObservationExpectationRow | undefined
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const merged = mergeExpectationPatch(existing, body)
  const result = validateObservationExpectation(db, merged, person.date_of_birth)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  const parsed = result.row

  const dup = db
    .prepare(
      `SELECT id FROM person_observation_expectations
        WHERE person_id = ? AND observation_type = ? COLLATE NOCASE AND id != ?`,
    )
    .get(personId, parsed.observation_type, expId) as { id: number } | undefined
  if (dup) {
    return NextResponse.json(
      { error: "Observation Type already exists for this person" },
      { status: 400 },
    )
  }

  db.prepare(
    `UPDATE person_observation_expectations SET
       observation_type = ?, cadence = ?, interval_days = ?, recurrence_day_of_month = ?,
       recurrence_month = ?, recurrence_day = ?, recurrence_use_birthday = ?, enabled = ?,
       due_time_hhmm = ?, tz = ?
     WHERE id = ? AND person_id = ?`,
  ).run(
    parsed.observation_type,
    parsed.cadence,
    parsed.interval_days,
    parsed.recurrence_day_of_month,
    parsed.recurrence_month,
    parsed.recurrence_day,
    parsed.recurrence_use_birthday,
    parsed.enabled,
    parsed.due_time_hhmm,
    parsed.tz,
    expId,
    personId,
  )

  auditLog(db, session.user?.email, "UPDATE", "person_observation_expectations", expId, {
    person_id: personId,
    observation_type: parsed.observation_type,
  })

  const row = db
    .prepare("SELECT * FROM person_observation_expectations WHERE id = ?")
    .get(expId) as PersonObservationExpectationRow

  const { sched, instanceIanaTz } = resolveObservationContext(db, request)
  return NextResponse.json({ expectation: enrichSingleExpectation(db, person, row, sched, instanceIanaTz) })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const { id } = await params
  const personId = parseInt(id, 10)
  const expIdRaw = new URL(request.url).searchParams.get("id")
  const expId = expIdRaw ? parseInt(expIdRaw, 10) : NaN
  if (!Number.isFinite(expId)) {
    return NextResponse.json({ error: "id query parameter is required" }, { status: 400 })
  }

  const db = getDb()
  const person = authorisePersonAccess(db, authResult, personId, "write")
  if (person instanceof NextResponse) return person

  const existing = db
    .prepare(
      "SELECT id, observation_type FROM person_observation_expectations WHERE id = ? AND person_id = ?",
    )
    .get(expId, personId) as { id: number; observation_type: string } | undefined
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  db.prepare("DELETE FROM person_observation_expectations WHERE id = ? AND person_id = ?").run(
    expId,
    personId,
  )

  auditLog(db, session.user?.email, "DELETE", "person_observation_expectations", expId, {
    person_id: personId,
    observation_type: existing.observation_type,
  })

  return NextResponse.json({ ok: true })
}
