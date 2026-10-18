// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@/lib/logger"

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { appendRecordedAtRangeFilters } from "@/lib/dashboard/dashboard-schedule-context"
import { rejectDemoProfanity } from "@/lib/demo/demo-profanity-guard"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { clampHistoryLimit } from "@/lib/api-row-limits"
import { parseScheduleTimesJson } from "@/lib/schedule/schedule-recurrence"
import { loadDoseTimingByRecord } from "@/lib/schedule/slot-outcome-reads"
import { resolveCalendarContext } from "@/lib/calendar-context"
import { sessionAccountUids } from "@/lib/account/account-identity"
import { validateMedicationRecordWrite } from "@/lib/medication/medication-record-validation"
import { recordDose } from "@/lib/medication/record-dose"
import { clearSupersededPrnPushRequests } from "@/lib/prn/prn-push-supersede"
import { sendMedicationAcknowledgementPushes, sendSelfDoseAcknowledgementPushes } from "@/lib/push"
import { decideDoseNotification } from "@/lib/push/dose-notification-decision"
import { recordingEndpointFromRequest } from "@/lib/push/recording-device"
import { changeLinks, parseIdList, validateLinkTargets } from "@/lib/symptoms/symptom-dose-links"

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
  appendRecordedAtRangeFilters(request, db, from, to, conditions, values, "r.recorded_at")
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
    administered_by: string | null
    medication_name: string
  }

  type ScheduleConfig = {
    schedule_times: string | null
    schedule_frequency: string | null
    schedule_start_date: string | null
    schedule_end_date: string | null
    schedule_tz: string | null
  }

  const enrichMedRows = (rows: MedRow[]) => {
    if (rows.length === 0) return rows

    const medicationIds = medId ? [parseInt(medId, 10)] : [...new Set(rows.map(r => r.medication_id))]

    const scheduleByMedId = new Map<number, ScheduleConfig | null>()
    for (const mid of medicationIds) {
      const scheduleRow = db
        .prepare(
          `SELECT schedule_times, schedule_frequency, schedule_start_date, schedule_end_date, schedule_tz
             FROM person_medications
            WHERE person_id = ? AND medication_id = ? AND is_active = 1`
        )
        .get(pid, mid) as ScheduleConfig | undefined
      scheduleByMedId.set(mid, scheduleRow?.schedule_times ? scheduleRow : null)
    }

    if ([...scheduleByMedId.values()].every(scheduleRow => scheduleRow === null)) return rows

    // Timing comes from the slot outcome stored when the dose was saved (or answered), so a later
    // schedule edit never relabels History. A scheduled medication's dose with no attached slot
    // (an extra dose, or one from before timing was stored) has `timing: null`.
    const timingByRecord = loadDoseTimingByRecord(db, rows.map(r => r.id))

    return rows.map(r => {
      const scheduleRow = scheduleByMedId.get(r.medication_id)
      if (!scheduleRow) return r
      if (parseScheduleTimesJson(scheduleRow.schedule_times).length === 0) return r
      return { ...r, timing: timingByRecord.get(r.id) ?? null }
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
  const { person_id, medication_id, recorded_at, dosage, dosage_unit, comments, administered_by } = body
  if (!person_id || !medication_id || !recorded_at) {
    return NextResponse.json({ error: "person_id, medication_id, and recorded_at are required" }, { status: 400 })
  }

  const db = getDb()
  const person = authorisePersonAccess(db, authResult, person_id, "write")
  if (person instanceof NextResponse) return person

  const profanity = await rejectDemoProfanity(typeof comments === "string" ? comments : null)
  if (profanity) return profanity

  // Opt-in symptom links offered on the form; never required, and an invalid list stops the write.
  const linkedSymptomIds = parseIdList(body.linked_symptom_ids)
  const linkError = linkedSymptomIds ? validateLinkTargets(db, person_id, linkedSymptomIds, []) : "Invalid id list"
  if (linkError) return NextResponse.json({ error: linkError }, { status: 400 })

  // ADR-0011: the shared write path deliberately never rejects for cooldown or 24h caps.
  const recorded = recordDose(db, {
    personId: person_id,
    medicationId: medication_id,
    recordedAt: recorded_at,
    dosage,
    dosageUnit: dosage_unit,
    comments: comments ?? null,
    administeredBy: administered_by,
    createdBy: session.user?.email ?? null,
    // Same calendar the schedule evaluator uses: the schedule zone, else the client's offset headers.
    calendarFor: (tz, atMs) => resolveCalendarContext(db, tz, atMs, request),
  })
  if (!recorded.ok) {
    return NextResponse.json({ error: recorded.error }, { status: 400 })
  }
  const { recordId, clearedPrnPushRequests } = recorded

  const medication = db.prepare("SELECT name FROM medications WHERE id = ?")
    .get(medication_id) as { name: string } | undefined

  auditLog(db, session.user?.email, "CREATE", "medication_records",
    recordId, { person_id, medication_id })
  if (linkedSymptomIds && linkedSymptomIds.length > 0) {
    changeLinks(db, {
      personId: person_id,
      actorEmail: session.user?.email ?? null,
      add: { symptomIds: linkedSymptomIds, recordIds: [recordId] },
    })
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

  // Only a dose attached to a slot clears the reminder. The recording device
  // closes its own copy by this tag; the recorder's other devices get "You gave…" in its place.
  const notification = decideDoseNotification({
    personId: person_id,
    medicationId: medication_id,
    clearsReminder: recorded.clearsReminder,
  })
  if (notification.replaceOnRecorderDevices) {
    sendSelfDoseAcknowledgementPushes(db, {
      personId: person_id,
      medicationId: medication_id,
      recorderUserUids: sessionAccountUids(session.user),
      recordingEndpoint: recordingEndpointFromRequest(request),
      personName: person.name,
      medicationName: medication?.name ?? "medication",
      recordedAt: recorded_at,
      tzOffsetMinutes,
    }).catch(err => logger.error("[records] self acknowledgement push failed:", err))
  }

  return NextResponse.json(
    {
      id: recordId,
      closeNotificationTag: notification.closeTag,
      clearedPrnPushRequests,
      dosageUnitMismatch: recorded.dosageUnitMismatch,
      timing: recorded.timing,
      clearsReminder: recorded.clearsReminder,
    },
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

  // Full-replace fields, not a partial patch: an omitted administered_by (like an omitted
  // comments/dosage_unit) is not "leave unchanged" — it resets to the default ("me"). Every
  // caller must resupply the current value, same as the other editable fields here.
  const { recorded_at, dosage, dosage_unit, comments, administered_by } = await request.json()
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
      administered_by,
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
      "UPDATE medication_records SET recorded_at = ?, dosage = ?, dosage_unit = ?, comments = ?, administered_by = ? WHERE id = ?"
    ).run(validated.recordedAt, validated.dosage, validated.dosageUnit, comments ?? null, validated.administeredBy, parseInt(id, 10))
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
