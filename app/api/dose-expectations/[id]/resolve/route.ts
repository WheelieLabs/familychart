// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { logger } from "@/lib/logger"
import { resolveCalendarContext } from "@/lib/calendar-context"
import { sessionAccountUids } from "@/lib/account/account-identity"
import { sendMedicationAcknowledgementPushes } from "@/lib/push"
import { doseExpectationTag } from "@/lib/push/notification-tags"
import { parseLocalYmd } from "@/lib/schedule/dose-expectation-input"
import { getDoseExpectationOwner } from "@/lib/schedule/dose-expectation-store"
import { resolveDoseExpectation, type DoseExpectationAnswer } from "@/lib/schedule/dose-expectation-resolve"

interface Params {
  params: Promise<{ id: string }>
}

const ANSWERS: readonly DoseExpectationAnswer[] = ["given", "missed", "not_yet"]

/**
 * Inline Yes / No / Not yet for a pending dose expectation. "Given" creates a real dose record
 * (recorded at the slot time, away from home) through the shared write path; "missed" is history
 * only; "not yet" snoozes the prompt.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const { id } = await params
  const expectationId = parseInt(id, 10)
  if (!Number.isFinite(expectationId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const db = getDb()
  const owner = getDoseExpectationOwner(db, expectationId)
  if (!owner) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const person = authorisePersonAccess(db, authResult, owner.personId, "write")
  if (person instanceof NextResponse) return person

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const ymd = parseLocalYmd(body.local_ymd)
  if (!ymd) return NextResponse.json({ error: "local_ymd must be a valid date (YYYY-MM-DD)" }, { status: 400 })
  const outcome = ANSWERS.find(a => a === body.outcome)
  if (!outcome) return NextResponse.json({ error: "outcome must be given, missed or not_yet" }, { status: 400 })

  const nowMs = Date.now()
  const result = resolveDoseExpectation(db, {
    expectationId,
    ymd,
    outcome,
    nowMs,
    resolveCalendar: tz => resolveCalendarContext(db, tz, nowMs, request),
    actor: session.user?.email ?? null,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  auditLog(db, session.user?.email, "UPDATE", "dose_expectations", expectationId, {
    local_ymd: ymd,
    outcome: result.outcome,
    medication_record_id: result.recordId,
  })

  if (result.recordId != null) {
    auditLog(db, session.user?.email, "CREATE", "medication_records", result.recordId, {
      person_id: result.personId,
      medication_id: result.medicationId,
      via: "dose_expectation",
    })
    // Same acknowledgement push as a normally logged dose, so other caregivers know it was given.
    const recorded = db
      .prepare("SELECT recorded_at FROM medication_records WHERE id = ?")
      .get(result.recordId) as { recorded_at: string } | undefined
    const tzOffsetRaw = request.headers.get("x-fc-tz-offset")
    const tzOffsetMinutes =
      tzOffsetRaw != null && Number.isFinite(parseInt(tzOffsetRaw, 10)) ? parseInt(tzOffsetRaw, 10) : 0
    if (recorded) {
      sendMedicationAcknowledgementPushes(
        db,
        result.personId,
        result.medicationId,
        sessionAccountUids(session.user),
        session.user?.name ?? session.user?.email ?? "Someone",
        person.name,
        owner.medicationName,
        recorded.recorded_at,
        tzOffsetMinutes,
      ).catch(err => logger.error("[dose-expectations] acknowledgement push failed:", err))
    }
  }

  // Given or Not given answers the question, so this device closes it; a snooze leaves it showing.
  const closeNotificationTag =
    result.outcome === "snoozed" ? null : doseExpectationTag(result.personId, result.medicationId)
  return NextResponse.json({ outcome: result.outcome, recordId: result.recordId, closeNotificationTag })
}
