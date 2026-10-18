// SPDX-License-Identifier: AGPL-3.0-only

import type { NextRequest } from "next/server"
import { localDateToIsoYmd } from "../datetime"

/**
 * The caller's local day and timezone offset from `dashboardScheduleHeaders()`, so "the dose's local
 * day" matches what the Calendar shows on the device. Falls back to the server clock without headers.
 */
export function clientDayContext(request: NextRequest): { todayYmd: string; tzOffsetMinutes: number } {
  const todayH = request.headers.get("x-fc-local-today")?.trim()
  const offRaw = request.headers.get("x-fc-tz-offset")
  const offset = offRaw != null && offRaw.trim() !== "" ? Number.parseInt(offRaw, 10) : NaN
  return {
    todayYmd: todayH && /^\d{4}-\d{2}-\d{2}$/.test(todayH) ? todayH : localDateToIsoYmd(new Date()),
    tzOffsetMinutes: Number.isFinite(offset) ? offset : new Date().getTimezoneOffset(),
  }
}
