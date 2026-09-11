// SPDX-License-Identifier: AGPL-3.0-only

import { localDateToIsoYmd } from "@/lib/datetime"

/**
 * Request headers so `/api/dashboard` can match record-medication: same local calendar,
 * `getTimezoneOffset()`, and “now” as seen in the browser.
 */
export function dashboardScheduleHeaders(): Record<string, string> {
  const now = new Date()
  const tzOffsetMinutes = now.getTimezoneOffset()
  const today = localDateToIsoYmd(now)
  const y = new Date(now.getTime())
  y.setDate(y.getDate() - 1)
  return {
    "X-FC-Client-Now": now.toISOString(),
    "X-FC-Tz-Offset": String(tzOffsetMinutes),
    "X-FC-Local-Today": today,
    "X-FC-Local-Yesterday": localDateToIsoYmd(y),
  }
}
