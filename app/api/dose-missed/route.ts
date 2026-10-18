// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { appendRecordedAtRangeFilters } from "@/lib/dashboard/dashboard-schedule-context"
import { clampHistoryLimit } from "@/lib/api-row-limits"
import { resolveCalendarContext } from "@/lib/calendar-context"
import { addCalendarDaysToIsoYmd } from "@/lib/datetime"
import type { DoseMissedSummary } from "@/lib/medication/dose-missed-history"
import { resolveSlotMs } from "@/lib/schedule/schedule-slot-evaluator"
import { loadMissedSlots } from "@/lib/schedule/slot-outcome-reads"

const YMD = /^\d{4}-\d{2}-\d{2}$/

/**
 * Missed doses for the History feed: slots that ended with no dose recorded (the next slot started,
 * the day ended, "Not given", or an Early answer), plus "Not given" answers from before slot
 * outcomes were stored. Each missed dose is listed once.
 */
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

  const medicationParam = searchParams.get("medication_id")
  const medicationId = medicationParam ? parseInt(medicationParam, 10) : undefined
  if (medicationId !== undefined && !Number.isInteger(medicationId)) {
    return NextResponse.json({ error: "medication_id must be a number" }, { status: 400 })
  }

  const from = searchParams.get("from")
  const to = searchParams.get("to")
  const limit = clampHistoryLimit(searchParams.get("limit"))
  const nowMs = Date.now()

  // The same day bounds as every other History list, applied to the slot instant.
  const bounds: string[] = []
  const boundValues: (string | number)[] = []
  appendRecordedAtRangeFilters(request, db, from, to, bounds, boundValues, "slot_at")
  const boundIso = (op: ">=" | "<="): string | undefined => {
    const i = bounds.findIndex(c => c.includes(op))
    return i >= 0 ? String(boundValues[i]) : undefined
  }
  const fromIso = boundIso(">=")
  const toIso = boundIso("<=")

  // One extra day each side: the slot instant moves a little with the viewer's timezone.
  const slots = loadMissedSlots(db, pid, {
    fromYmd: from && YMD.test(from) ? addCalendarDaysToIsoYmd(from, -1) : null,
    toYmd: to && YMD.test(to) ? addCalendarDaysToIsoYmd(to, 1) : null,
  }, medicationId)
  const fromSlots: DoseMissedSummary[] = []
  for (const s of slots) {
    const ctx = resolveCalendarContext(db, s.scheduleTz, nowMs, request)
    if (!ctx) continue
    const ms = resolveSlotMs(ctx, s.ymd, s.slotHhmm)
    if (!Number.isFinite(ms)) continue
    const iso = new Date(ms).toISOString()
    if ((fromIso && iso < fromIso) || (toIso && iso > toIso)) continue
    fromSlots.push({
      id: `slot:${s.id}`,
      person_id: s.personId,
      medication_name: s.medicationName,
      recorded_at: iso,
      cause: s.cause ?? "timed_out",
    })
  }

  const when = "COALESCE(o.slot_at, o.resolved_at)"
  const conditions: string[] = ["pm.person_id = ?", "o.status = 'confirmed_missed'"]
  const values: (string | number)[] = [pid]
  if (medicationId !== undefined) {
    conditions.push("pm.medication_id = ?")
    values.push(medicationId)
  }
  appendRecordedAtRangeFilters(request, db, from, to, conditions, values, when)
  const legacy = db
    .prepare(
      `SELECT o.id AS id, pm.person_id AS person_id, m.name AS medication_name, ${when} AS recorded_at
         FROM dose_expectation_outcomes o
         JOIN dose_expectations de ON de.id = o.dose_expectation_id
         JOIN person_medications pm ON pm.id = de.person_medication_id
         JOIN medications m ON m.id = pm.medication_id
        WHERE ${conditions.join(" AND ")}
          AND NOT EXISTS (
            SELECT 1 FROM slot_outcomes so
             WHERE so.person_medication_id = pm.id AND so.local_ymd = o.local_ymd AND so.slot_hhmm = de.slot_hhmm
          )
        ORDER BY recorded_at DESC, o.id DESC LIMIT ?`,
    )
    .all(...values, limit) as { id: number; person_id: number; medication_name: string; recorded_at: string }[]

  const rows: DoseMissedSummary[] = [
    ...fromSlots,
    ...legacy.map((r): DoseMissedSummary => ({
      id: `answer:${r.id}`,
      person_id: r.person_id,
      medication_name: r.medication_name,
      recorded_at: r.recorded_at,
      cause: "not_given",
    })),
  ]
  rows.sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : a.recorded_at > b.recorded_at ? -1 : a.id < b.id ? 1 : -1))
  return NextResponse.json(rows.slice(0, limit))
}
