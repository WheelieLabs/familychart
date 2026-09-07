// SPDX-License-Identifier: AGPL-3.0-only

import type { NextRequest } from "next/server"
import type Database from "better-sqlite3-multiple-ciphers"
import {
  parseClientNow,
  resolveCalendarContext,
  serverAuthoritativeLocalYmd,
} from "@/lib/calendar-context"
import { parseScheduleFrequencyJson, parseScheduleTimesJson } from "@/lib/schedule/schedule-recurrence"
import { loadSlotEvaluatorConfig } from "@/lib/schedule/schedule-config"
import { findNextSuppressibleSlot } from "@/lib/schedule/schedule-slot-evaluator"

export interface PersonMedicationScheduleRow {
  id: number
  schedule_times: string
  schedule_frequency: string | null
  schedule_start_date: string | null
  schedule_end_date: string | null
  schedule_tz: string | null
}

/**
 * Opt-in cancel of the next scheduled slot after a recorded dose.
 *
 * Only suppresses a slot on the **server-authoritative local calendar day** in the
 * effective IANA timezone (or process-local day when no IANA is set). Forged
 * `x-fc-client-now` / `x-fc-local-today` headers that resolve to a different day
 * are ignored — the dose is still recorded by the caller; only the suppression
 * is skipped.
 *
 * @returns true when a suppression row was inserted
 */
export function trySuppressNextScheduleSlot(
  db: Database.Database,
  opts: {
    personMedication: PersonMedicationScheduleRow
    recordedAtMs: number
    recordId: number
    createdBy: string | null
    request: NextRequest
    /** Override for tests; defaults to `Date.now()`. */
    serverNowMs?: number
  },
): boolean {
  const pm = opts.personMedication
  const serverNowMs = opts.serverNowMs ?? Date.now()
  const clientNow = parseClientNow(opts.request)
  const calCtx = resolveCalendarContext(db, pm.schedule_tz, clientNow.getTime(), opts.request)
  if (!calCtx) return false

  const serverYmd = serverAuthoritativeLocalYmd(db, pm.schedule_tz, serverNowMs)
  if (calCtx.ymd !== serverYmd) return false

  // Shared with the client preview and cron/dashboard assembly — resolveSlotMs
  // (IANA when available) instead of manual offset math.
  const next = findNextSuppressibleSlot(
    opts.recordedAtMs,
    {
      scheduleTimes: parseScheduleTimesJson(pm.schedule_times),
      scheduleFrequency: parseScheduleFrequencyJson(pm.schedule_frequency),
      scheduleStartDate: pm.schedule_start_date,
      scheduleEndDate: pm.schedule_end_date,
    },
    calCtx,
    loadSlotEvaluatorConfig(db),
  )
  if (!next) return false

  db.prepare(
    `INSERT OR IGNORE INTO schedule_reminder_suppressions
     (person_medication_id, local_ymd, slot_hhmm, medication_record_id, created_by)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(pm.id, calCtx.ymd, next.hhmm, opts.recordId, opts.createdBy)
  return true
}
