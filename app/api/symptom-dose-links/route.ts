// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { clientDayContext } from "@/lib/symptoms/link-request-context"
import {
  SYMPTOM_FORM_DOSE_CAP,
  changeLinks,
  parseIdList,
  candidateDosesForSpan,
  candidateSymptomsForDose,
  linkedDosesForSymptom,
  linkedSymptomsForDose,
  listPersonLinks,
  validateLinkTargets,
} from "@/lib/symptoms/symptom-dose-links"

function validIso(raw: string | null): string | null {
  return raw && Number.isFinite(Date.parse(raw)) ? raw : null
}

/**
 * Reads for the symptom/dose link control. With only `person_id`: every link (History chips).
 * `symptom_id` / `record_id`: what that record is linked to. `candidates=symptoms&recorded_at=` and
 * `candidates=doses&start=[&end=][&limit=]` (or `&symptom_id=` for a saved symptom's span): what could be linked.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult

  const { searchParams } = new URL(request.url)
  const personId = parseInt(searchParams.get("person_id") ?? "", 10)
  if (!Number.isFinite(personId)) return NextResponse.json({ error: "person_id is required" }, { status: 400 })

  const db = getDb()
  const person = authorisePersonAccess(db, authResult, personId, "read")
  if (person instanceof NextResponse) return person

  const { todayYmd, tzOffsetMinutes } = clientDayContext(request)
  const candidates = searchParams.get("candidates")
  const symptomId = parseInt(searchParams.get("symptom_id") ?? "", 10)
  const recordId = parseInt(searchParams.get("record_id") ?? "", 10)

  if (candidates === "symptoms") {
    const recordedAt = validIso(searchParams.get("recorded_at"))
    if (!recordedAt) return NextResponse.json({ error: "recorded_at is required" }, { status: 400 })
    return NextResponse.json(candidateSymptomsForDose(db, personId, recordedAt, todayYmd, tzOffsetMinutes))
  }

  if (candidates === "doses") {
    let span: { start_date: string; end_date: string | null; is_resolved: boolean; resolved_at: string | null }
    if (Number.isFinite(symptomId)) {
      const row = db.prepare(
        "SELECT start_date, end_date, is_resolved, resolved_at FROM symptom_events WHERE id = ? AND person_id = ?"
      ).get(symptomId, personId) as { start_date: string; end_date: string | null; is_resolved: number; resolved_at: string | null } | undefined
      if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })
      span = { ...row, is_resolved: row.is_resolved === 1 }
    } else {
      const start = validIso(searchParams.get("start"))
      if (!start) return NextResponse.json({ error: "start is required" }, { status: 400 })
      span = { start_date: start, end_date: validIso(searchParams.get("end")), is_resolved: false, resolved_at: null }
    }
    const capParam = searchParams.get("limit")
    const limit = capParam ? Math.min(Math.max(parseInt(capParam, 10) || SYMPTOM_FORM_DOSE_CAP, 1), 200) : undefined
    return NextResponse.json(candidateDosesForSpan(db, personId, span, todayYmd, tzOffsetMinutes, limit))
  }

  if (Number.isFinite(symptomId)) {
    const owned = db.prepare("SELECT 1 FROM symptom_events WHERE id = ? AND person_id = ?").get(symptomId, personId)
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(linkedDosesForSymptom(db, symptomId))
  }
  if (Number.isFinite(recordId)) {
    const owned = db.prepare("SELECT 1 FROM medication_records WHERE id = ? AND person_id = ?").get(recordId, personId)
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(linkedSymptomsForDose(db, recordId))
  }

  return NextResponse.json(listPersonLinks(db, personId))
}

interface LinkChangeBody {
  person_id?: number
  /** Edit a symptom's links: dose ids to add and remove. */
  symptom_id?: number
  add_record_ids?: unknown
  remove_record_ids?: unknown
  /** Edit a dose's links: symptom ids to add and remove. */
  record_id?: number
  add_symptom_ids?: unknown
  remove_symptom_ids?: unknown
}

/** Adds and removes links from either side of the relationship in one transaction. */
export async function PUT(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const body = (await request.json()) as LinkChangeBody
  if (!Number.isInteger(body.person_id)) return NextResponse.json({ error: "person_id is required" }, { status: 400 })
  const personId = body.person_id as number

  const db = getDb()
  const person = authorisePersonAccess(db, authResult, personId, "write")
  if (person instanceof NextResponse) return person

  const addRecords = parseIdList(body.add_record_ids)
  const removeRecords = parseIdList(body.remove_record_ids)
  const addSymptoms = parseIdList(body.add_symptom_ids)
  const removeSymptoms = parseIdList(body.remove_symptom_ids)
  if (!addRecords || !removeRecords || !addSymptoms || !removeSymptoms) {
    return NextResponse.json({ error: "Invalid id list" }, { status: 400 })
  }

  let toAdd: { symptomIds: number[]; recordIds: number[] }
  let toRemove: { symptomIds: number[]; recordIds: number[] }
  if (Number.isInteger(body.symptom_id)) {
    const s = body.symptom_id as number
    toAdd = { symptomIds: [s], recordIds: addRecords }
    toRemove = { symptomIds: [s], recordIds: removeRecords }
  } else if (Number.isInteger(body.record_id)) {
    const r = body.record_id as number
    toAdd = { symptomIds: addSymptoms, recordIds: [r] }
    toRemove = { symptomIds: removeSymptoms, recordIds: [r] }
  } else {
    return NextResponse.json({ error: "symptom_id or record_id is required" }, { status: 400 })
  }

  // Same Person on both sides, or nothing is written.
  const invalid =
    validateLinkTargets(db, personId, [...toAdd.symptomIds, ...toRemove.symptomIds], [...toAdd.recordIds, ...toRemove.recordIds])
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })

  const result = changeLinks(db, { personId, actorEmail: session.user?.email ?? null, add: toAdd, remove: toRemove })
  return NextResponse.json({ ok: true, ...result })
}
