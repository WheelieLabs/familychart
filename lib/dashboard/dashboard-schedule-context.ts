// SPDX-License-Identifier: AGPL-3.0-only

import type { NextRequest } from "next/server"
import { localYmdRangeToUtcIsoBounds } from "@/lib/datetime"

/**
 * Append recorded_at range filters using local calendar bounds when the client
 * sent `dashboardScheduleHeaders()`; otherwise UTC midnight (legacy).
 */
export function appendRecordedAtRangeFilters(
  request: NextRequest,
  from: string | null,
  to: string | null,
  conditions: string[],
  values: (string | number)[],
  column = "recorded_at",
): void {
  if (!from && !to) return

  const todayH = request.headers.get("x-fc-local-today")?.trim()
  const hasClientDay = todayH != null && /^\d{4}-\d{2}-\d{2}$/.test(todayH)

  if (hasClientDay && from && to) {
    const offRaw = request.headers.get("x-fc-tz-offset")
    const tzOffsetMinutes =
      offRaw != null && offRaw.trim() !== "" && Number.isFinite(Number.parseInt(offRaw, 10))
        ? Number.parseInt(offRaw, 10)
        : new Date().getTimezoneOffset()
    const bounds = localYmdRangeToUtcIsoBounds(from, to, tzOffsetMinutes)
    if (bounds) {
      conditions.push(`${column} >= ?`)
      values.push(bounds.fromUtc)
      conditions.push(`${column} <= ?`)
      values.push(bounds.toUtc)
      return
    }
  }

  if (from) {
    conditions.push(`${column} >= ?`)
    values.push(`${from}T00:00:00.000Z`)
  }
  if (to) {
    conditions.push(`${column} <= ?`)
    values.push(`${to}T23:59:59.999Z`)
  }
}
