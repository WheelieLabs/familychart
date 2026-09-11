// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@/lib/logger"

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRead, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import type { Person } from "@/lib/domain-types"
import {
  resolveTimesAndSlotsForPersonMedicationPatch,
  resolveTimesAndSlotsForPersonMedicationPost,
  type MedScheduleSlot,
  validateMedicationScheduleInput,
} from "@/lib/schedule/schedule-input"
import {
  resolvePersonMedicationScheduleTzForPatch,
  resolveScheduleTzForWrite,
  validateScheduleIanaTz,
} from "@/lib/instance-timezone"
interface Params {
  params: Promise<{ id: string }>
}

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
      `SELECT pm.id, pm.person_id, pm.medication_id, pm.is_active,
              pm.schedule_times, pm.schedule_slots, pm.schedule_frequency, pm.schedule_start_date, pm.schedule_end_date,
              pm.schedule_tz,
              m.name AS medication_name, m.dosage_unit, m.default_dosage
         FROM person_medications pm
         JOIN medications m ON m.id = pm.medication_id
        WHERE pm.person_id = ?
        ORDER BY pm.is_active DESC, m.name COLLATE NOCASE`
    )
    .all(personId) as Array<Record<string, unknown>>

  return NextResponse.json(rows)
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

  const medicationId =
    typeof body.medication_id === "number"
      ? body.medication_id
      : typeof body.medication_id === "string"
        ? parseInt(body.medication_id, 10)
        : NaN
  if (!Number.isFinite(medicationId)) {
    return NextResponse.json({ error: "medication_id is required" }, { status: 400 })
  }

  const med = db
    .prepare("SELECT id, default_dosage FROM medications WHERE id = ? AND is_active = 1")
    .get(medicationId) as { id: number; default_dosage: number | null } | undefined
  if (!med) return NextResponse.json({ error: "Medication not found" }, { status: 404 })

  let timesNorm: string[]
  let slotsNorm: { times: string[]; slots: MedScheduleSlot[] }
  try {
    slotsNorm = resolveTimesAndSlotsForPersonMedicationPost(body, med.default_dosage)
    timesNorm = slotsNorm.times
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid schedule"
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  let sched: ReturnType<typeof validateMedicationScheduleInput>
  try {
    sched = validateMedicationScheduleInput(
      timesNorm,
      body.schedule_frequency ?? null,
      typeof body.schedule_start_date === "string" ? body.schedule_start_date : null,
      typeof body.schedule_end_date === "string" ? body.schedule_end_date : null,
      timesNorm.length > 0 ? slotsNorm.slots : null
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid schedule"
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const scheduleActive = timesNorm.length > 0
  const tzResolved = scheduleActive ? resolveScheduleTzForWrite(body.tz, db) : null
  const tzCheck = validateScheduleIanaTz(tzResolved)
  if (!tzCheck.ok) return NextResponse.json({ error: tzCheck.error }, { status: 400 })
  const tz = tzCheck.tz

  try {
    const result = db
      .prepare(
        `INSERT INTO person_medications (person_id, medication_id, is_active,
          schedule_times, schedule_slots, schedule_frequency, schedule_start_date, schedule_end_date, schedule_tz)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(person_id, medication_id) DO UPDATE SET
           is_active = 1,
           schedule_times = excluded.schedule_times,
           schedule_slots = excluded.schedule_slots,
           schedule_frequency = excluded.schedule_frequency,
           schedule_start_date = excluded.schedule_start_date,
           schedule_end_date = excluded.schedule_end_date,
           schedule_tz = excluded.schedule_tz`
      )
      .run(
        personId,
        medicationId,
        sched.timesJson,
        sched.slotsJson,
        sched.frequencyJson,
        sched.start,
        sched.end,
        tz
      )

    const rowId = Number(result.lastInsertRowid)
    const pmRow = db
      .prepare("SELECT id FROM person_medications WHERE person_id = ? AND medication_id = ?")
      .get(personId, medicationId) as { id: number } | undefined
    auditLog(db, session.user?.email, "UPSERT", "person_medications", pmRow?.id ?? rowId, {
      person_id: personId,
      medication_id: medicationId,
    })

    const row = db
      .prepare(
        `SELECT pm.id, pm.person_id, pm.medication_id, pm.is_active,
                pm.schedule_times, pm.schedule_slots, pm.schedule_frequency, pm.schedule_start_date, pm.schedule_end_date,
                pm.schedule_tz,
                m.name AS medication_name, m.dosage_unit, m.default_dosage
           FROM person_medications pm
           JOIN medications m ON m.id = pm.medication_id
          WHERE pm.person_id = ? AND pm.medication_id = ?`
      )
      .get(personId, medicationId)

    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    logger.error("[person-medications POST]", e)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const { id } = await params
  const personId = parseInt(id, 10)
  if (!Number.isFinite(personId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const pmIdRaw = new URL(request.url).searchParams.get("id")
  const pmId = pmIdRaw ? parseInt(pmIdRaw, 10) : NaN
  if (!Number.isFinite(pmId)) return NextResponse.json({ error: "id query parameter is required" }, { status: 400 })

  const db = getDb()
  const person = authorisePersonAccess(db, authResult, personId, "write")
  if (person instanceof NextResponse) return person

  const existing = db
    .prepare("SELECT id FROM person_medications WHERE id = ? AND person_id = ?")
    .get(pmId, personId) as { id: number } | undefined
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const rowFull = db
    .prepare(
      `SELECT pm.schedule_times, pm.schedule_slots, pm.schedule_frequency, pm.schedule_start_date, pm.schedule_end_date,
              pm.is_active, pm.schedule_tz, m.default_dosage AS med_default_dosage
         FROM person_medications pm
         JOIN medications m ON m.id = pm.medication_id
        WHERE pm.id = ?`
    )
    .get(pmId) as {
    schedule_times: string | null
    schedule_slots: string | null
    schedule_frequency: string | null
    schedule_start_date: string | null
    schedule_end_date: string | null
    is_active: number
    schedule_tz: string | null
    med_default_dosage: number | null
  }

  let nextFreqRaw: unknown
  let nextStart: string | null | undefined
  let nextEnd: string | null | undefined

  if ("schedule_frequency" in body) {
    nextFreqRaw = body.schedule_frequency
  } else {
    nextFreqRaw = rowFull.schedule_frequency
  }

  if ("schedule_start_date" in body) {
    nextStart = typeof body.schedule_start_date === "string" ? body.schedule_start_date : null
  } else {
    nextStart = rowFull.schedule_start_date ?? undefined
  }

  if ("schedule_end_date" in body) {
    nextEnd = typeof body.schedule_end_date === "string" ? body.schedule_end_date : null
  } else {
    nextEnd = rowFull.schedule_end_date ?? undefined
  }

  let nextTimes: string[]
  let nextSlots: MedScheduleSlot[]
  try {
    const resolved = resolveTimesAndSlotsForPersonMedicationPatch(
      body,
      rowFull.schedule_times,
      rowFull.schedule_slots,
      rowFull.med_default_dosage
    )
    nextTimes = resolved.times
    nextSlots = resolved.slots
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid schedule"
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  let sched: ReturnType<typeof validateMedicationScheduleInput>
  try {
    sched = validateMedicationScheduleInput(
      nextTimes,
      nextFreqRaw,
      nextStart,
      nextEnd,
      nextTimes.length > 0 ? nextSlots : null
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid schedule"
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const nextActive =
    body.is_active === 0 || body.is_active === false ? 0 : body.is_active === 1 || body.is_active === true ? 1 : rowFull.is_active

  const scheduleActive = nextActive === 1 && nextTimes.length > 0
  const tzResolved = resolvePersonMedicationScheduleTzForPatch(
    body,
    rowFull.schedule_tz,
    scheduleActive,
    db,
  )
  const tzCheck = validateScheduleIanaTz(tzResolved)
  if (!tzCheck.ok) return NextResponse.json({ error: tzCheck.error }, { status: 400 })
  const tz = tzCheck.tz

  db.prepare(
    `UPDATE person_medications SET
       is_active = ?,
       schedule_times = ?, schedule_slots = ?, schedule_frequency = ?, schedule_start_date = ?, schedule_end_date = ?,
       schedule_tz = ?
     WHERE id = ? AND person_id = ?`
  ).run(
    nextActive,
    sched.timesJson,
    sched.slotsJson,
    sched.frequencyJson,
    sched.start,
    sched.end,
    tz,
    pmId,
    personId
  )

  auditLog(db, session.user?.email, "UPDATE", "person_medications", pmId, {
    person_id: personId,
    is_active: nextActive,
  })

  const row = db
    .prepare(
      `SELECT pm.id, pm.person_id, pm.medication_id, pm.is_active,
              pm.schedule_times, pm.schedule_slots, pm.schedule_frequency, pm.schedule_start_date, pm.schedule_end_date,
              pm.schedule_tz,
              m.name AS medication_name, m.dosage_unit, m.default_dosage
         FROM person_medications pm
         JOIN medications m ON m.id = pm.medication_id
        WHERE pm.id = ?`
    )
    .get(pmId)

  return NextResponse.json(row)
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const { id } = await params
  const personId = parseInt(id, 10)
  if (!Number.isFinite(personId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const pmIdRaw = new URL(request.url).searchParams.get("id")
  const pmId = pmIdRaw ? parseInt(pmIdRaw, 10) : NaN
  if (!Number.isFinite(pmId)) return NextResponse.json({ error: "id query parameter is required" }, { status: 400 })

  const db = getDb()
  const person = authorisePersonAccess(db, authResult, personId, "write")
  if (person instanceof NextResponse) return person

  const existing = db
    .prepare("SELECT id, medication_id FROM person_medications WHERE id = ? AND person_id = ?")
    .get(pmId, personId) as { id: number; medication_id: number } | undefined
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  db.prepare("DELETE FROM person_medications WHERE id = ? AND person_id = ?").run(pmId, personId)
  auditLog(db, session.user?.email, "DELETE", "person_medications", pmId, {
    person_id: personId,
    medication_id: existing.medication_id,
  })

  return NextResponse.json({ ok: true })
}
