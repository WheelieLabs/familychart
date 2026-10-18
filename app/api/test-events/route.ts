// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { appendRecordedAtRangeFilters } from "@/lib/dashboard/dashboard-schedule-context"
import { rejectDemoProfanity } from "@/lib/demo/demo-profanity-guard"
import { clampHistoryLimit } from "@/lib/api-row-limits"
import { validateTestAttachmentUrlWrite } from "@/lib/test-results/attachment-url"
import { deleteAttachmentIfUnreferenced } from "@/lib/test-results/attachment-cleanup"
import {
  validateTestEventWrite,
  validateTestResultValueWrite,
  type TestResultValueWriteInput,
} from "@/lib/test-results/test-result-validation"
import type { LimitQualifier } from "@/lib/domain-types"
import type { TestResultSummary, TestResultValueSummary } from "@/lib/test-results/test-result-history"

type ValidatedTestResultValue = Extract<ReturnType<typeof validateTestResultValueWrite>, { ok: true }>

interface TestEventRow {
  id: number
  person_id: number
  test_type: string
  name: string
  date: string
  ordered_by: string | null
  notes: string | null
  attachment_url: string | null
}

interface TestResultValueRow {
  test_event_id: number
  metric_name: string
  value_type: "numeric" | "qualitative"
  numeric_value: number | null
  qualitative_value: string | null
  unit: string | null
  reference_range: string | null
  flag: string | null
  limit_qualifier: LimitQualifier | null
}

/** Validates a raw `values` array from a POST/PATCH body, shared by both write handlers. */
function parseTestResultValues(
  db: ReturnType<typeof getDb>,
  rawValues: unknown,
): { ok: true; values: ValidatedTestResultValue[] } | { ok: false; error: string } {
  const values: ValidatedTestResultValue[] = []
  for (const raw of Array.isArray(rawValues) ? rawValues : []) {
    const result = validateTestResultValueWrite(db, raw as TestResultValueWriteInput)
    if (!result.ok) return result
    values.push(result)
  }
  return { ok: true, values }
}

function toSummary(event: TestEventRow, values: TestResultValueRow[]): TestResultSummary {
  return {
    id: event.id,
    person_id: event.person_id,
    test_type: event.test_type,
    name: event.name,
    date: event.date,
    ordered_by: event.ordered_by,
    notes: event.notes,
    attachment_url: event.attachment_url,
    values: values.map((v): TestResultValueSummary => ({
      metric_name: v.metric_name,
      value_type: v.value_type,
      numeric_value: v.numeric_value,
      qualitative_value: v.qualitative_value,
      unit: v.unit,
      reference_range: v.reference_range,
      flag: v.flag,
      limit_qualifier: v.limit_qualifier,
    })),
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
  appendRecordedAtRangeFilters(request, db, from, to, conditions, values, "date")

  const events = db.prepare(
    `SELECT id, person_id, test_type, name, date, ordered_by, notes, attachment_url
       FROM test_events WHERE ${conditions.join(" AND ")}
      ORDER BY date DESC, id DESC LIMIT ?`
  ).all(...values, clampHistoryLimit(searchParams.get("limit"))) as TestEventRow[]

  if (events.length === 0) return NextResponse.json([])

  const valueRows = db.prepare(
    `SELECT test_event_id, metric_name, value_type, numeric_value, qualitative_value, unit, reference_range, flag, limit_qualifier
       FROM test_result_values WHERE test_event_id IN (${events.map(() => "?").join(",")})`
  ).all(...events.map(e => e.id)) as TestResultValueRow[]

  const valuesByEvent = new Map<number, TestResultValueRow[]>()
  for (const v of valueRows) {
    const list = valuesByEvent.get(v.test_event_id) ?? []
    list.push(v)
    valuesByEvent.set(v.test_event_id, list)
  }

  return NextResponse.json(events.map(e => toSummary(e, valuesByEvent.get(e.id) ?? [])))
}

interface TestEventPostBody {
  person_id?: number
  test_type?: unknown
  name?: unknown
  date?: unknown
  ordered_by?: unknown
  notes?: unknown
  attachment_url?: unknown
  values?: unknown
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const body = (await request.json()) as TestEventPostBody
  const { person_id, test_type, name, date, ordered_by, notes, attachment_url, values } = body
  if (!person_id) return NextResponse.json({ error: "person_id is required" }, { status: 400 })

  const db = getDb()
  const person = authorisePersonAccess(db, authResult, person_id, "write")
  if (person instanceof NextResponse) return person

  const eventResult = validateTestEventWrite({ test_type, name, date, ordered_by, notes })
  if (!eventResult.ok) return NextResponse.json({ error: eventResult.error }, { status: 400 })

  const valuesResult = parseTestResultValues(db, values)
  if (!valuesResult.ok) return NextResponse.json({ error: valuesResult.error }, { status: 400 })
  const validatedValues = valuesResult.values

  // Catalogue metric names are trusted (curated, not caller-supplied text) — only an "other"
  // metric name is free text a caller controls, same footing as testType/name/notes.
  const profanity = await rejectDemoProfanity(
    eventResult.testType, eventResult.name, eventResult.notes,
    ...validatedValues.filter(v => v.isOther).map(v => v.metricName),
  )
  if (profanity) return profanity

  const attachmentResult = validateTestAttachmentUrlWrite(db, attachment_url, person_id)
  if (!attachmentResult.ok) return NextResponse.json({ error: attachmentResult.error }, { status: 400 })
  const attachmentUrl = attachmentResult.attachmentUrl

  const insertEvent = db.prepare(
    `INSERT INTO test_events (person_id, test_type, name, date, ordered_by, notes, attachment_url, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertValue = db.prepare(
    `INSERT INTO test_result_values
      (test_event_id, metric_name, value_type, numeric_value, qualitative_value, unit, reference_range, flag, limit_qualifier)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const eventId = db.transaction(() => {
    const result = insertEvent.run(
      person_id, eventResult.testType, eventResult.name, eventResult.date,
      eventResult.orderedBy, eventResult.notes, attachmentUrl, session.user?.email ?? null,
    )
    const id = Number(result.lastInsertRowid)
    for (const v of validatedValues) {
      insertValue.run(id, v.metricName, v.valueType, v.numericValue, v.qualitativeValue, v.unit, v.referenceRange, v.flag, v.limitQualifier)
    }
    return id
  })()

  auditLog(db, session.user?.email, "CREATE", "test_events", eventId, { person_id, test_type: eventResult.testType })

  return NextResponse.json({ id: eventId }, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const id = new URL(request.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })
  const eventId = parseInt(id, 10)

  const db = getDb()
  const existing = db.prepare("SELECT id, person_id, attachment_url FROM test_events WHERE id = ?")
    .get(eventId) as { id: number; person_id: number; attachment_url: string | null } | undefined
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const person = authorisePersonAccess(db, authResult, existing.person_id, "write")
  if (person instanceof NextResponse) return person

  const body = (await request.json()) as TestEventPostBody
  const { test_type, name, date, ordered_by, notes, attachment_url, values } = body

  const eventResult = validateTestEventWrite({ test_type, name, date, ordered_by, notes })
  if (!eventResult.ok) return NextResponse.json({ error: eventResult.error }, { status: 400 })

  const valuesResult = parseTestResultValues(db, values)
  if (!valuesResult.ok) return NextResponse.json({ error: valuesResult.error }, { status: 400 })
  const validatedValues = valuesResult.values

  const profanity = await rejectDemoProfanity(
    eventResult.testType, eventResult.name, eventResult.notes,
    ...validatedValues.filter(v => v.isOther).map(v => v.metricName),
  )
  if (profanity) return profanity

  const attachmentResult = validateTestAttachmentUrlWrite(db, attachment_url, existing.person_id)
  if (!attachmentResult.ok) return NextResponse.json({ error: attachmentResult.error }, { status: 400 })
  const attachmentUrl = attachmentResult.attachmentUrl

  const insertValue = db.prepare(
    `INSERT INTO test_result_values
      (test_event_id, metric_name, value_type, numeric_value, qualitative_value, unit, reference_range, flag, limit_qualifier)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  db.transaction(() => {
    db.prepare(
      `UPDATE test_events SET test_type = ?, name = ?, date = ?, ordered_by = ?, notes = ?, attachment_url = ?
       WHERE id = ?`
    ).run(eventResult.testType, eventResult.name, eventResult.date, eventResult.orderedBy, eventResult.notes, attachmentUrl, eventId)
    db.prepare("DELETE FROM test_result_values WHERE test_event_id = ?").run(eventId)
    for (const v of validatedValues) {
      insertValue.run(eventId, v.metricName, v.valueType, v.numericValue, v.qualitativeValue, v.unit, v.referenceRange, v.flag, v.limitQualifier)
    }
  })()

  auditLog(db, session.user?.email, "UPDATE", "test_events", eventId, { person_id: existing.person_id })

  // The attachment was replaced or removed: the previous file is no longer referenced.
  if (existing.attachment_url && existing.attachment_url !== attachmentUrl) {
    await deleteAttachmentIfUnreferenced(db, existing.attachment_url)
  }

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
  const existing = db.prepare("SELECT id, person_id, attachment_url FROM test_events WHERE id = ?")
    .get(eventId) as { id: number; person_id: number; attachment_url: string | null } | undefined
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const person = authorisePersonAccess(db, authResult, existing.person_id, "write")
  if (person instanceof NextResponse) return person

  db.prepare("DELETE FROM test_events WHERE id = ?").run(eventId)
  auditLog(db, session.user?.email, "DELETE", "test_events", eventId, { person_id: existing.person_id })

  await deleteAttachmentIfUnreferenced(db, existing.attachment_url)

  return NextResponse.json({ ok: true })
}
