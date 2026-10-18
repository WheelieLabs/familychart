// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import type { NextRequest } from "next/server"
import { ianaLocalYmdHmToUtcMs, localCalendarYmdHmToUtcMs } from "@/lib/datetime"
import { resolveAgeTimezone } from "@/lib/instance-timezone"

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Append recorded_at range filters for `from` / `to` calendar days (`YYYY-MM-DD`).
 *
 * Days are read in the client's local calendar when the request carries the
 * `dashboardScheduleHeaders()`, otherwise in the instance timezone (UTC when none is set).
 * A bound that is not a valid calendar day is ignored.
 */
export function appendRecordedAtRangeFilters(
  request: NextRequest,
  db: Database.Database,
  from: string | null,
  to: string | null,
  conditions: string[],
  values: (string | number)[],
  column = "recorded_at",
): void {
  if (!from && !to) return

  const todayH = request.headers.get("x-fc-local-today")?.trim()
  const hasClientDay = todayH != null && YMD_RE.test(todayH)

  let dayBoundMs: (ymd: string, hm: string) => number
  if (hasClientDay) {
    const offRaw = request.headers.get("x-fc-tz-offset")
    const tzOffsetMinutes =
      offRaw != null && offRaw.trim() !== "" && Number.isFinite(Number.parseInt(offRaw, 10))
        ? Number.parseInt(offRaw, 10)
        : new Date().getTimezoneOffset()
    dayBoundMs = (ymd, hm) => localCalendarYmdHmToUtcMs(ymd, hm, tzOffsetMinutes)
  } else {
    const timeZone = resolveAgeTimezone(db)
    dayBoundMs = (ymd, hm) => ianaLocalYmdHmToUtcMs(ymd, hm, timeZone)
  }

  const fromYmd = from?.trim() ?? ""
  if (YMD_RE.test(fromYmd)) {
    const ms = dayBoundMs(fromYmd, "00:00")
    if (Number.isFinite(ms)) {
      conditions.push(`${column} >= ?`)
      values.push(new Date(ms).toISOString())
    }
  }
  const toYmd = to?.trim() ?? ""
  if (YMD_RE.test(toYmd)) {
    const ms = dayBoundMs(toYmd, "23:59") + 59_999
    if (Number.isFinite(ms)) {
      conditions.push(`${column} <= ?`)
      values.push(new Date(ms).toISOString())
    }
  }
}
