// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { resolveCalendarContext, type CalendarContext } from "@/lib/calendar-context"
import { addCalendarDaysToIsoYmd } from "@/lib/datetime"
import { loadMissedSlots } from "@/lib/schedule/slot-outcome-reads"
import { localYmdAt } from "@/lib/schedule/slot-outcomes"

/** A Missed slot shown as a quiet line on the dashboard. Not an alert: it raises nothing and blocks nothing. */
export interface DashboardMissedSlot {
  /** The slot outcome row, for a stable list key. */
  id: number
  medicationName: string
  /** The dose time, "HH:mm" on the schedule's wall clock. */
  slotHhmm: string
  /** Which Calendar day the dose was due. */
  day: "today" | "yesterday"
}

/**
 * Missed slots that became Missed during the current Calendar day (Schedule clock), per Person.
 * They drop off when the day ends. A last slot that timed out at midnight belongs to the new day,
 * so it still reads as "yesterday's" dose.
 */
export function listDashboardMissedSlots(
  db: Database.Database,
  personIds: readonly number[],
  nowMs: number,
  fallbackCtx: CalendarContext,
): Map<number, DashboardMissedSlot[]> {
  const out = new Map<number, DashboardMissedSlot[]>()
  for (const pid of personIds) {
    const todayFallback = fallbackCtx.ymd
    const slots = loadMissedSlots(db, pid, { fromYmd: addCalendarDaysToIsoYmd(todayFallback, -2), toYmd: addCalendarDaysToIsoYmd(todayFallback, 1) })
    const list: DashboardMissedSlot[] = []
    for (const s of slots) {
      const ctx = resolveCalendarContext(db, s.scheduleTz, nowMs) ?? fallbackCtx
      const today = ctx.ymd
      const settledYmd = s.settledAtMs != null && Number.isFinite(s.settledAtMs) ? localYmdAt(ctx, s.settledAtMs) : s.ymd
      if (settledYmd !== today) continue
      list.push({
        id: s.id,
        medicationName: s.medicationName,
        slotHhmm: s.slotHhmm,
        day: s.ymd === today ? "today" : "yesterday",
      })
    }
    // Oldest first, so the lines read in the order the doses were due.
    list.reverse()
    out.set(pid, list)
  }
  return out
}
