// SPDX-License-Identifier: AGPL-3.0-only

import { localDateAndTimeToUtcIso, zonedTodayYmd } from "../datetime"
import { getDisplayTimeZone } from "../display-time-zone"

/**
 * The stored timestamp for a retrospective Test date: midday on the chosen day in the instance
 * timezone, so the entry never lands on the wrong day. Today's midday may still be ahead of `now`,
 * which the server rejects as future-dated, so it is clamped to `now` (still the same day).
 */
export function testDateToStoredIso(ymd: string, now: Date = new Date(), timeZone: string = getDisplayTimeZone()): string {
  const midday = new Date(localDateAndTimeToUtcIso(ymd, "12:00", timeZone))
  return (midday.getTime() > now.getTime() ? now : midday).toISOString()
}

/** True when `ymd` is a calendar day after today in the instance timezone (the form blocks these before the server does). */
export function isFutureTestDate(ymd: string, now: Date = new Date(), timeZone: string = getDisplayTimeZone()): boolean {
  return ymd !== "" && ymd > zonedTodayYmd(now.getTime(), timeZone)
}
