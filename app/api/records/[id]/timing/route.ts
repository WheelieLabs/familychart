// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { sessionAccountUids } from "@/lib/account/account-identity"
import { requireAuth, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { resolveCalendarContext } from "@/lib/calendar-context"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { logger } from "@/lib/logger"
import { sendSelfDoseAcknowledgementPushes } from "@/lib/push"
import { decideDoseNotification } from "@/lib/push/dose-notification-decision"
import { recordingEndpointFromRequest } from "@/lib/push/recording-device"
import { answerDoseTiming, type PromptAnswer } from "@/lib/schedule/slot-outcomes"

interface Params { params: Promise<{ id: string }> }

const ANSWERS: readonly PromptAnswer[] = ["late", "early", "extra"]

/**
 * Answers the "Which dose was this?" prompt for a dose that was saved outside every slot window.
 * The dose is already stored; this only attaches it (Late, Early) or leaves it an extra dose. The
 * slot is worked out again from the stored dose, so the client never names one.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const { id } = await params
  const recordId = /^\d+$/.test(id) ? parseInt(id, 10) : NaN
  if (!Number.isSafeInteger(recordId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const body = await request.json().catch(() => null)
  const answer = body?.answer as PromptAnswer | undefined
  if (!answer || !ANSWERS.includes(answer)) {
    return NextResponse.json({ error: "answer must be late, early or extra" }, { status: 400 })
  }

  const db = getDb()
  const record = db
    .prepare("SELECT person_id, medication_id, recorded_at FROM medication_records WHERE id = ?")
    .get(recordId) as { person_id: number; medication_id: number; recorded_at: string } | undefined
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const person = authorisePersonAccess(db, authResult, record.person_id, "write")
  if (person instanceof NextResponse) return person

  const result = answerDoseTiming(db, {
    recordId,
    answer,
    nowMs: Date.now(),
    calendarFor: (tz, atMs) => resolveCalendarContext(db, tz, atMs, request),
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  if (result.attachedSlot) {
    auditLog(db, session.user?.email, "UPDATE", "medication_records", recordId, { timing_answer: answer })
  }
  // Answering Late or Early attaches the dose, which is what clears the reminder (Extra does not).
  const notification = decideDoseNotification({
    personId: record.person_id,
    medicationId: record.medication_id,
    clearsReminder: result.clearsReminder,
  })
  if (notification.replaceOnRecorderDevices) {
    const medication = db.prepare("SELECT name FROM medications WHERE id = ?").get(record.medication_id) as
      | { name: string }
      | undefined
    const offsetRaw = request.headers.get("x-fc-tz-offset")
    sendSelfDoseAcknowledgementPushes(db, {
      personId: record.person_id,
      medicationId: record.medication_id,
      recorderUserUids: sessionAccountUids(session.user),
      recordingEndpoint: recordingEndpointFromRequest(request),
      personName: person.name,
      medicationName: medication?.name ?? "medication",
      recordedAt: record.recorded_at,
      tzOffsetMinutes: offsetRaw != null && Number.isFinite(parseInt(offsetRaw, 10)) ? parseInt(offsetRaw, 10) : 0,
    }).catch(err => logger.error("[records] self acknowledgement push failed:", err))
  }
  return NextResponse.json({
    closeNotificationTag: notification.closeTag,
    answer: result.answer,
    clearsReminder: result.clearsReminder,
    attachedSlot: result.attachedSlot,
    missed: result.missed,
  })
}
