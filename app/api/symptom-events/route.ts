// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { appendRecordedAtRangeFilters } from "@/lib/dashboard/dashboard-schedule-context"
import { rejectDemoProfanity } from "@/lib/demo/demo-profanity-guard"
import { clampHistoryLimit } from "@/lib/api-row-limits"
import { nextResolvedAt } from "@/lib/symptoms/symptom-resolved-at"
import { appendSymptomOverlapFilters } from "@/lib/symptoms/symptom-overlap"
import { validateSymptomEventWrite } from "@/lib/symptoms/symptom-validation"
import type { SymptomEventSummary } from "@/lib/symptoms/symptom-history"
import { resolveCalendarContext } from "@/lib/calendar-context"
import { changeLinks, parseIdList, validateLinkTargets } from "@/lib/symptoms/symptom-dose-links"

interface SymptomEventRow {
  id: number
  person_id: number
  label: string
  start_date: string
  end_date: string | null
  severity: number
  is_resolved: number
  resolved_at: string | null
  notes: string | null
}

function toSummary(row: SymptomEventRow): SymptomEventSummary {
  return {
    id: row.id,
    person_id: row.person_id,
    label: row.label,
    start_date: row.start_date,
    end_date: row.end_date,
    severity: row.severity,
    is_resolved: row.is_resolved === 1,
    resolved_at: row.resolved_at,
    notes: row.notes,
  }
}

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

  const from = searchParams.get("from")
  const to = searchParams.get("to")

  const conditions: string[] = ["person_id = ?"]
  const values: (string | number)[] = [pid]
  if (searchParams.get("overlap") === "1" && from && to) {
    // Window bounds come from the same local-day handling as the other range filters.
    const boundConditions: string[] = []
    const bounds: (string | number)[] = []
    appendRecordedAtRangeFilters(request, db, from, to, boundConditions, bounds, "start_date")
    if (bounds.length === 2) appendSymptomOverlapFilters(conditions, values, String(bounds[0]), String(bounds[1]))
  } else {
    appendRecordedAtRangeFilters(request, db, from, to, conditions, values, "start_date")
  }

  const rows = db.prepare(
    `SELECT id, person_id, label, start_date, end_date, severity, is_resolved, resolved_at, notes
       FROM symptom_events WHERE ${conditions.join(" AND ")}
      ORDER BY start_date DESC, id DESC LIMIT ?`
  ).all(...values, clampHistoryLimit(searchParams.get("limit"))) as SymptomEventRow[]

  return NextResponse.json(rows.map(toSummary))
}

interface SymptomEventPostBody {
  person_id?: number
  label?: unknown
  start_date?: unknown
  end_date?: unknown
  severity?: unknown
  is_resolved?: unknown
  notes?: unknown
  /** Doses to link to the new symptom (opt-in, same Person). */
  linked_record_ids?: unknown
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const body = (await request.json()) as SymptomEventPostBody
  const { person_id, label, start_date, end_date, severity, is_resolved, notes } = body
  if (!person_id) return NextResponse.json({ error: "person_id is required" }, { status: 400 })

  const db = getDb()
  const person = authorisePersonAccess(db, authResult, person_id, "write")
  if (person instanceof NextResponse) return person

  const result = validateSymptomEventWrite({ label, start_date, end_date, severity, is_resolved, notes })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  const profanity = await rejectDemoProfanity(result.label, result.notes)
  if (profanity) return profanity

  const linkedRecordIds = parseIdList(body.linked_record_ids)
  const linkError = linkedRecordIds ? validateLinkTargets(db, person_id, [], linkedRecordIds) : "Invalid id list"
  if (linkError) return NextResponse.json({ error: linkError }, { status: 400 })

  const resolvedAt = nextResolvedAt(result.isResolved, false, null)

  const insert = db.prepare(
    `INSERT INTO symptom_events (person_id, label, start_date, end_date, severity, is_resolved, resolved_at, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const inserted = insert.run(
    person_id, result.label, result.startDate, result.endDate, result.severity,
    result.isResolved ? 1 : 0, resolvedAt, result.notes, session.user?.email ?? null,
  )
  const id = Number(inserted.lastInsertRowid)

  auditLog(db, session.user?.email, "CREATE", "symptom_events", id, { person_id })
  if (linkedRecordIds && linkedRecordIds.length > 0) {
    changeLinks(db, {
      personId: person_id,
      actorEmail: session.user?.email ?? null,
      add: { symptomIds: [id], recordIds: linkedRecordIds },
    })
  }

  return NextResponse.json({ id }, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const id = new URL(request.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })
  const eventId = parseInt(id, 10)

  const db = getDb()
  const existing = db.prepare("SELECT id, person_id, is_resolved, resolved_at FROM symptom_events WHERE id = ?")
    .get(eventId) as { id: number; person_id: number; is_resolved: number; resolved_at: string | null } | undefined
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const person = authorisePersonAccess(db, authResult, existing.person_id, "write")
  if (person instanceof NextResponse) return person

  const body = (await request.json()) as SymptomEventPostBody
  const { label, start_date, end_date, severity, is_resolved, notes } = body

  const result = validateSymptomEventWrite({ label, start_date, end_date, severity, is_resolved, notes })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  const profanity = await rejectDemoProfanity(result.label, result.notes)
  if (profanity) return profanity

  const resolvedAt = nextResolvedAt(result.isResolved, existing.is_resolved === 1, existing.resolved_at)

  db.prepare(
    `UPDATE symptom_events
        SET label = ?, start_date = ?, end_date = ?, severity = ?, is_resolved = ?, resolved_at = ?, notes = ?
      WHERE id = ?`
  ).run(result.label, result.startDate, result.endDate, result.severity, result.isResolved ? 1 : 0, resolvedAt, result.notes, eventId)

  // Saving a symptom that is still open counts as today's "still ongoing" answer to the daily prompt.
  if (!result.isResolved && result.endDate === null) {
    const today = resolveCalendarContext(db, null, Date.now(), request)
    if (today) db.prepare("UPDATE symptom_events SET ongoing_confirmed_on = ? WHERE id = ?").run(today.ymd, eventId)
  }

  auditLog(db, session.user?.email, "UPDATE", "symptom_events", eventId, { person_id: existing.person_id })

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const id = new URL(request.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })
  const eventId = parseInt(id, 10)

  const db = getDb()
  const existing = db.prepare("SELECT id, person_id FROM symptom_events WHERE id = ?")
    .get(eventId) as { id: number; person_id: number } | undefined
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const person = authorisePersonAccess(db, authResult, existing.person_id, "write")
  if (person instanceof NextResponse) return person

  db.prepare("DELETE FROM symptom_events WHERE id = ?").run(eventId)
  auditLog(db, session.user?.email, "DELETE", "symptom_events", eventId, { person_id: existing.person_id })

  return NextResponse.json({ ok: true })
}
