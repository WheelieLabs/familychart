// SPDX-License-Identifier: AGPL-3.0-only

import { ianaLocalYmdHmToUtcMs, tzLocalYmdAndOffset } from "@/lib/datetime"
import { isValidIanaTz } from "@/lib/settings/registry"

/**
 * Person age from an ISO `YYYY-MM-DD` date of birth.
 *
 * Two named operations (do not collapse them):
 * - {@link fractionalAgeYears} — continuous age for catalogue / min_age / max_age gates (÷ 365.25 days)
 * - {@link completedCalendarYears} — whole birthday-based years for display and under-18 UX
 *
 * Birthday boundaries use a caller-supplied IANA timezone (instance `locale.default_timezone`
 * on server paths; same value from `GET /api/me` on the client). Empty or invalid `timeZone`
 * is treated as `UTC`. DOB is midnight in that zone; calendar “today” is the wall date of
 * `asOf` (or now) in that zone.
 *
 * Leap-day (calendar): a 29 Feb DOB ticks the new age on **1 March** in non-leap years.
 */

const MS_PER_YEAR = 1000 * 60 * 60 * 24 * 365.25

/** Empty or invalid IANA → `UTC` (same rule as missing instance timezone). */
export function normalizeAgeTimeZone(timeZone: string): string {
  const trimmed = timeZone.trim()
  if (trimmed === "" || !isValidIanaTz(trimmed)) return "UTC"
  return trimmed
}

function parseDobMidnightMs(dateOfBirth: string, timeZone: string): number {
  if (dateOfBirth === "") return NaN
  const ms = ianaLocalYmdHmToUtcMs(dateOfBirth, "00:00", timeZone)
  return Number.isFinite(ms) ? ms : NaN
}

/** Continuous age in years for medication/observation age-band gates. */
export function fractionalAgeYears(dateOfBirth: string, timeZone: string, asOf?: Date): number {
  const tz = normalizeAgeTimeZone(timeZone)
  const dob = parseDobMidnightMs(dateOfBirth, tz)
  if (!Number.isFinite(dob)) return NaN
  const now = asOf ?? new Date()
  return (now.getTime() - dob) / MS_PER_YEAR
}

/**
 * Completed calendar years (birthday-based) for display and under-18 UX.
 * Feb 29 DOBs advance on 1 March in non-leap years.
 */
export function completedCalendarYears(dateOfBirth: string, timeZone: string, asOf?: Date): number {
  const tz = normalizeAgeTimeZone(timeZone)
  const dobMs = parseDobMidnightMs(dateOfBirth, tz)
  if (!Number.isFinite(dobMs)) return NaN

  const [by, bm, bd] = dateOfBirth.split("-").map(s => parseInt(s, 10))
  if (![by, bm, bd].every(n => Number.isFinite(n))) return NaN

  const now = asOf ?? new Date()
  const todayYmd = tzLocalYmdAndOffset(now.getTime(), tz).ymd
  const [ty, tm, td] = todayYmd.split("-").map(s => parseInt(s, 10))
  if (![ty, tm, td].every(n => Number.isFinite(n))) return NaN

  let age = ty - by
  if (tm < bm || (tm === bm && td < bd)) age--
  return age
}
