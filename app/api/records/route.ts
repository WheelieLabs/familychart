// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@/lib/logger"

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { appendRecordedAtRangeFilters } from "@/lib/dashboard/dashboard-schedule-context"
import { rejectDemoProfanity } from "@/lib/demo/demo-profanity-guard"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { clampHistoryLimit } from "@/lib/api-row-limits"
import { loadScheduleSlotMatchConfig } from "@/lib/schedule/schedule-config"
import { resolveSlotMatchOffsetMinutes } from "@/lib/instance-timezone"
import {
  matchRecordToScheduledSlot,
  parseScheduleFrequencyUnknown,
  parseScheduleTimesJson,
} from "@/lib/schedule/schedule-recurrence"
import { sessionAccountUids } from "@/lib/account/account-identity"
import { validateMedicationRecordWrite } from "@/lib/medication/medication-record-validation"
import { ensureActivePersonMedicationLink } from "@/lib/person/person-medication-assign"
import { sendMedicationAcknowledgementPushes } from "@/lib/push"
import { trySuppressNextScheduleSlot } from "@/lib/schedule/schedule-reminder-suppression"
import { clearSupersededPrnPushRequests } from "@/lib/prn/prn-push-supersede"

export async function GET(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const { searchParams } = new URL(request.url)
  const personId = searchParams.get("person_id")
  if (!personId) return NextResponse.json({ error: "person_id is required" }, { status: 400 })

  const db = getDb()
  const pid = parseInt(personId, 10)
  const person = authorisePersonAccess(db, authResult, pid, "read")
  if (person instanceof NextResponse) return person

  if (searchParams.get("summary") === "true") {
    return NextResponse.json(
      db
        .prepare(
          `SELECT m.id, m.name, m.dosage_unit,
         MAX(mr.recorded_at) as last_recorded,
         COUNT(*) as total_doses
       FROM medication_records mr
       JOIN medications m ON m.id = mr.medication_id
       WHERE mr.person_id = ?
       GROUP BY m.id
       ORDER BY last_recorded DESC`
        )
        .all(pid)
    )
  }

  const from = searchParams.get("from")
  const to = searchParams.get("to")
  const medId = searchParams.get("medication_id")

  const conditions: string[] = ["r.person_id = ?"]
  const values: (string | number)[] = [pid]
  appendRecordedAtRangeFilters(request, from, to, conditions, values, "r.recorded_at")
  if (medId) {
    conditions.push("r.medication_id = ?")
    values.push(parseInt(medId, 10))
  }

  const limit = searchParams.get("limit")
  const cursorTs = searchParams.get("cursorTs")
  const cursorId = searchParams.get("cursorId")

  type MedRow = {
    id: number
    person_id: number
    medication_id: number
    recorded_at: string
    dosage: number | null
    dosage_unit: string | null
    comments: string | null
    medication_name: string
  }

  const enrichMedRows = (rows: MedRow[]) => {
    if (!medId) return rows

    const mid = parseInt(medId, 10)
    const pm = db
      .prepare(
        `SELECT schedule_times, schedule_frequency, schedule_start_date, schedule_end_date, schedule_tz
           FROM person_medications
          WHERE person_id = ? AND medication_id = ? AND is_active = 1`
      )
      .get(pid, mid) as {
      schedule_times: string | null
      schedule_frequency: string | null
      schedule_start_date: string | null
      schedule_end_date: string | null
      schedule_tz: string | null
    } | undefined

    if (!pm?.schedule_times) return rows

    const timesHm = parseScheduleTimesJson(pm.schedule_times)
    if (timesHm.length === 0) return rows

    const freq = parseScheduleFrequencyUnknown(pm.schedule_frequency ?? null)
    const offRaw = request.headers.get("x-fc-tz-offset")
    const clientOffsetMinutes =
      offRaw != null && Number.isFinite(Number.parseInt(offRaw, 10))
        ? Number.parseInt(offRaw, 10)
        : new Date().getTimezoneOffset()
    const slotMatchConfig = loadScheduleSlotMatchConfig(db)

    return rows.map(r => {
      const recordedAt = new Date(r.recorded_at)
      const match = matchRecordToScheduledSlot(
        recordedAt,
        timesHm,
        freq,
        pm.schedule_start_date,
        pm.schedule_end_date,
        resolveSlotMatchOffsetMinutes(
          recordedAt.getTime(),
          pm.schedule_tz,
          clientOffsetMinutes,
          db,
        ),
        slotMatchConfig,
      )
      return {
        ...r,
        scheduled_time: match?.slotTimeLabel ?? null,
        scheduled_late: match === null ? null : match.late,
      }
    })
  }

  if (!limit) {
    const rows = db
      .prepare(
        `SELECT r.*, m.name AS medication_name FROM medication_records r
       JOIN medications m ON m.id = r.medication_id
       WHERE ${conditions.join(" AND ")} ORDER BY r.recorded_at DESC, r.id DESC LIMIT ?`
      )
      .all(...values, clampHistoryLimit(null)) as MedRow[]

    return NextResponse.json(enrichMedRows(rows))
  }

  const n = clampHistoryLimit(limit)
  if (cursorTs && cursorId) {
    conditions.push("(r.recorded_at < ? OR (r.recorded_at = ? AND r.id < ?))")
    values.push(cursorTs, cursorTs, parseInt(cursorId, 10))
  }

  const sql = `SELECT r.*, m.name AS medication_name FROM medication_records r
     JOIN medications m ON m.id = r.medication_id
     WHERE ${conditions.join(" AND ")} ORDER BY r.recorded_at DESC, r.id DESC LIMIT ?`
  values.push(n + 1)

  const all = db.prepare(sql).all(...values) as MedRow[]
  const hasMore = all.length > n
  const rows = hasMore ? all.slice(0, n) : all
  const nextCursor = hasMore ? { ts: rows[n - 1]!.recorded_at, id: rows[n - 1]!.id } : null
  return NextResponse.json({ rows: enrichMedRows(rows), nextCursor })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const body = await request.json()
  const { person_id, medication_id, recorded_at, dosage, dosage_unit, comments, suppressNextSlot } = body
  if (!person_id || !medication_id || !recorded_at) {
    return NextResponse.json({ error: "person_id, medication_id, and recorded_at are required" }, { status: 400 })
  }

  const db = getDb()
  const person = authorisePersonAccess(db, authResult, person_id, "write")
  if (person instanceof NextResponse) return person

  const profanity = await rejectDemoProfanity(typeof comments === "string" ? comments : null)
  if (profanity) return profanity

  // requirePersonLink:false — recording a dose assigns the medication to the person below
  // (see ensureActivePersonMedicationLink), so we don't force a pre-existing link here. The
  // medication's existence/active state and age bounds are still enforced; an
  // age-ineligible medication is rejected before any link is created.
  //
  // ADR-0011: deliberately do NOT call evaluatePrnState / reject for cooldown or
  // 24h caps. FamilyChart is a record-keeping tool — frequency rules drive dashboard alerts
  // and reminders only; valid writes always succeed so history can reflect what happened.
  const validated = validateMedicationRecordWrite(
    db,
    {
      medication_id,
      recorded_at,
      dosage,
      dosage_unit,
      person_id,
    },
    { requirePersonLink: false },
  )
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  // Recording a dose is itself an act of assigning the medication to the person. Create or
  // reactivate the link so the age-bounds/unit-match invariant holds while ad-hoc/PRN recording from the
  // Record Medication screen keeps working (the screen offers the whole catalogue, not just
  // already-assigned medications).
  ensureActivePersonMedicationLink(db, person_id, medication_id, session.user?.email)

  const medication = db.prepare("SELECT name FROM medications WHERE id = ?")
    .get(medication_id) as { name: string } | undefined

  const insertAndSupersede = db.transaction(() => {
    const result = db.prepare(
      `INSERT INTO medication_records (person_id, medication_id, recorded_at, dosage, dosage_unit, comments, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(person_id, medication_id, validated.recordedAt, validated.dosage,
          validated.dosageUnit, comments ?? null, session.user?.email ?? null)
    const insertedId = Number(result.lastInsertRowid)
    const cleared = clearSupersededPrnPushRequests(db, {
      personId: person_id,
      medicationId: medication_id,
      currentRecordId: insertedId,
      recordedAt: validated.recordedAt,
    })
    return { recordId: insertedId, clearedPrnPushRequests: cleared }
  })
  const { recordId, clearedPrnPushRequests } = insertAndSupersede()
  auditLog(db, session.user?.email, "CREATE", "medication_records",
    recordId, { person_id, medication_id })

  // Opt-in suppression: cancel the next scheduled slot today only (server-local day)
  if (suppressNextSlot === true) {
    const pm = db.prepare(
      `SELECT id, schedule_times, schedule_frequency, schedule_start_date, schedule_end_date, schedule_tz
       FROM person_medications
       WHERE person_id = ? AND medication_id = ? AND is_active = 1
       LIMIT 1`
    ).get(person_id, medication_id) as {
      id: number
      schedule_times: string | null
      schedule_frequency: string | null
      schedule_start_date: string | null
      schedule_end_date: string | null
      schedule_tz: string | null
    } | undefined

    if (pm?.schedule_times) {
      trySuppressNextScheduleSlot(db, {
        personMedication: {
          id: pm.id,
          schedule_times: pm.schedule_times,
          schedule_frequency: pm.schedule_frequency,
          schedule_start_date: pm.schedule_start_date,
          schedule_end_date: pm.schedule_end_date,
          schedule_tz: pm.schedule_tz,
        },
        recordedAtMs: new Date(recorded_at).getTime(),
        recordId,
        createdBy: session.user?.email ?? null,
        request,
      })
    }
  }

  const tzOffsetRaw = request.headers.get("x-fc-tz-offset")
  const tzOffsetMinutes = tzOffsetRaw != null && Number.isFinite(parseInt(tzOffsetRaw, 10))
    ? parseInt(tzOffsetRaw, 10)
    : 0
  sendMedicationAcknowledgementPushes(
    db,
    person_id,
    medication_id,
    sessionAccountUids(session.user),
    session.user?.name ?? session.user?.email ?? "Someone",
    person.name,
    medication?.name ?? "medication",
    recorded_at,
    tzOffsetMinutes
  ).catch(err => logger.error("[records] acknowledgement push failed:", err))

  return NextResponse.json(
    { id: recordId, clearedPrnPushRequests, dosageUnitMismatch: validated.dosageUnitMismatch },
    { status: 201 },
  )
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const id = new URL(request.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  const db = getDb()
  const record = db.prepare(
    "SELECT mr.id, mr.person_id, mr.medication_id, mr.recorded_at FROM medication_records mr WHERE mr.id = ?"
  ).get(parseInt(id, 10)) as { id: number; person_id: number; medication_id: number; recorded_at: string } | undefined
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const person = authorisePersonAccess(db, authResult, record.person_id, "write")
  if (person instanceof NextResponse) return person

  const { recorded_at, dosage, dosage_unit, comments } = await request.json()
  const profanity = await rejectDemoProfanity(typeof comments === "string" ? comments : null)
  if (profanity) return profanity
  // requirePersonLink:false — the record already exists, so the person↔medication pairing is
  // historical fact; editing it must not fail just because the medication was never (or is no
  // longer) in person_medications. Age bounds are still enforced.
  // ADR-0011: no cooldown / 24h-cap write gate on PATCH either.
  const validated = validateMedicationRecordWrite(
    db,
    {
      medication_id: record.medication_id,
      recorded_at,
      dosage,
      dosage_unit,
      person_id: record.person_id,
    },
    { requirePersonLink: false },
  )
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  const recordedAtChanged = validated.recordedAt !== record.recorded_at
  const updateAndSupersede = db.transaction(() => {
    db.prepare(
      "UPDATE medication_records SET recorded_at = ?, dosage = ?, dosage_unit = ?, comments = ? WHERE id = ?"
    ).run(validated.recordedAt, validated.dosage, validated.dosageUnit, comments ?? null, parseInt(id, 10))
    // Only clear when recorded_at actually changed — dosage/comments-only edits don't.
    if (!recordedAtChanged) return 0
    return clearSupersededPrnPushRequests(db, {
      personId: record.person_id,
      medicationId: record.medication_id,
      currentRecordId: record.id,
      recordedAt: validated.recordedAt,
    })
  })
  const clearedPrnPushRequests = updateAndSupersede()
  auditLog(db, session.user?.email, "UPDATE", "medication_records", parseInt(id, 10), {
    person_id: record.person_id,
    medication_id: record.medication_id,
    recorded_at: validated.recordedAt,
  })
  return NextResponse.json({ ok: true, clearedPrnPushRequests, dosageUnitMismatch: validated.dosageUnitMismatch })
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const id = new URL(request.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  const db = getDb()
  const record = db.prepare(
    "SELECT mr.id, mr.person_id FROM medication_records mr WHERE mr.id = ?"
  ).get(parseInt(id, 10)) as { id: number; person_id: number } | undefined
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const person = authorisePersonAccess(db, authResult, record.person_id, "write")
  if (person instanceof NextResponse) return person

  db.prepare("DELETE FROM medication_records WHERE id = ?").run(parseInt(id, 10))
  auditLog(db, session.user?.email, "DELETE", "medication_records", parseInt(id, 10), {})
  return NextResponse.json({ ok: true })
}
