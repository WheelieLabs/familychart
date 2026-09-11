// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Local wall time from HTML date + time inputs → ISO-8601 UTC instant (suffix Z).
 * Matches record-medication when run in the browser (local date + time, no zone suffix).
 */
export function localDateAndTimeToUtcIso(date: string, time: string): string {
  return new Date(`${date.trim()}T${time.trim()}`).toISOString()
}

export const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** Parse a `HH:mm` string into hours and minutes, or return null if invalid. */
export function parseHHMM(s: string): { h: number; m: number } | null {
  const t = s.trim()
  const m = t.match(HHMM_RE)
  if (!m) return null
  const h = parseInt(m[1]!, 10)
  const min = parseInt(m[2]!, 10)
  if (h > 23 || min > 59) return null
  return { h, m: min }
}

/** Format normalised `HH:mm`. */
export function formatHHMM(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

/**
 * Accept user-entered schedule time: `HH:mm`, `H:mm`, or compact `HHMM`.
 * Returns normalised `HH:mm` or null.
 */
export function parseScheduleTimeUserInput(s: string): string | null {
  const t = s.trim()
  if (/^\d{4}$/.test(t)) {
    const h = parseInt(t.slice(0, 2), 10)
    const m = parseInt(t.slice(2, 4), 10)
    if (h > 23 || m > 59) return null
    return formatHHMM(h, m)
  }
  const hm = parseHHMM(t)
  if (!hm) return null
  return formatHHMM(hm.h, hm.m)
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

/** Local calendar date as `YYYY-MM-DD` from a `Date` (browser or server runtime timezone). */
export function localDateToIsoYmd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Add whole calendar days to an ISO `YYYY-MM-DD` (Gregorian, UTC calendar math). */
export function addCalendarDaysToIsoYmd(ymd: string, deltaDays: number): string {
  if (!YMD_RE.test(ymd.trim())) return ymd.trim()
  const [y, m, d] = ymd.trim().split("-").map(s => parseInt(s, 10))
  const t = Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0, 0)
  const nd = new Date(t)
  return `${nd.getUTCFullYear()}-${String(nd.getUTCMonth() + 1).padStart(2, "0")}-${String(
    nd.getUTCDate()
  ).padStart(2, "0")}`
}

/**
 * Same UTC instant as `new Date(\`${dateYmd}T${timeHm}\`)` in a browser whose
 * `Date.prototype.getTimezoneOffset()` equals `timezoneOffsetMinutes` (send that value from the client).
 */
/** Local calendar-day bounds for history range filters (client `getTimezoneOffset()`). */
export function localYmdRangeToUtcIsoBounds(
  fromYmd: string,
  toYmd: string,
  tzOffsetMinutes: number,
): { fromUtc: string; toUtc: string } | null {
  const from = fromYmd.trim()
  const to = toYmd.trim()
  if (!YMD_RE.test(from) || !YMD_RE.test(to)) return null
  const fromMs = localCalendarYmdHmToUtcMs(from, "00:00", tzOffsetMinutes)
  const toMs = localCalendarYmdHmToUtcMs(to, "23:59", tzOffsetMinutes) + 59_999
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null
  return { fromUtc: new Date(fromMs).toISOString(), toUtc: new Date(toMs).toISOString() }
}

export function localCalendarYmdHmToUtcMs(
  dateYmd: string,
  timeHm: string,
  timezoneOffsetMinutes: number
): number {
  const [y, month, day] = dateYmd.trim().split("-").map(s => parseInt(s, 10))
  const tm = timeHm.trim().match(HHMM_RE)
  if (!tm || !Number.isFinite(y) || !Number.isFinite(month) || !Number.isFinite(day)) return NaN
  const h = parseInt(tm[1]!, 10)
  const mi = parseInt(tm[2]!, 10)
  return Date.UTC(y, month - 1, day, h, mi, 0, 0) + timezoneOffsetMinutes * 60 * 1000
}

/**
 * Inverse of {@link localCalendarYmdHmToUtcMs} for the same `timezoneOffsetMinutes`
 * (`Date#getTimezoneOffset()` from the browser).
 */
export function utcMsToLocalYmd(utcMs: number, timezoneOffsetMinutes: number): string {
  const adj = utcMs - timezoneOffsetMinutes * 60 * 1000
  const d = new Date(adj)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/**
 * Relative-day qualifier for a `YYYY-MM-DD` target vs. "today"/"tomorrow" in the same
 * local timezone — null when same day, "tomorrow" when next day, else a short
 * weekday+date fallback (e.g. "Wed 15 Jul").
 */
export function dayQualifierForYmd(targetYmd: string, todayYmd: string, tomorrowYmd: string): string | null {
  if (targetYmd === todayYmd) return null
  if (targetYmd === tomorrowYmd) return "tomorrow"
  const [y, m, d] = targetYmd.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return `${WEEKDAY_SHORT[dt.getUTCDay()]} ${d} ${MONTH_SHORT[dt.getUTCMonth()]}`
}

/** Minutes since local midnight for a UTC instant and client `getTimezoneOffset()` value. */
export function utcMsToLocalMinutesSinceMidnight(utcMs: number, timezoneOffsetMinutes: number): number {
  const adj = utcMs - timezoneOffsetMinutes * 60 * 1000
  const d = new Date(adj)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

/**
 * Given a UTC timestamp and an IANA timezone name, return the local calendar date (`YYYY-MM-DD`)
 * and the UTC offset in minutes (`Date#getTimezoneOffset()` convention: positive = west).
 * Used by server-side code (cron, overdue checks) that has no live request context.
 */
export function tzLocalYmdAndOffset(nowMs: number, tzName: string): { ymd: string; offsetMinutes: number } {
  const roundedMs = Math.floor(nowMs / 60000) * 60000
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tzName,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(roundedMs).map(p => [p.type, p.value]))
  const y = parseInt(parts.year!), mo = parseInt(parts.month!), d = parseInt(parts.day!)
  const h = parseInt(parts.hour!) % 24, m = parseInt(parts.minute!)
  const localAsUtcMs = Date.UTC(y, mo - 1, d, h, m)
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    offsetMinutes: (roundedMs - localAsUtcMs) / 60000,
  }
}

/**
 * UTC instant for a local wall time in an IANA timezone (handles DST per instant).
 * Refines offset at the computed instant so day boundaries stay correct across transitions.
 */
export function ianaLocalYmdHmToUtcMs(dateYmd: string, timeHm: string, tzName: string): number {
  if (!YMD_RE.test(dateYmd.trim()) || !parseHHMM(timeHm.trim())) return NaN
  const [y, month, day] = dateYmd.trim().split("-").map(s => parseInt(s, 10))
  if (!Number.isFinite(y) || !Number.isFinite(month) || !Number.isFinite(day)) return NaN

  const noonUtcMs = Date.UTC(y, month - 1, day, 12, 0, 0, 0)
  let offsetMinutes = tzLocalYmdAndOffset(noonUtcMs, tzName).offsetMinutes
  let utcMs = localCalendarYmdHmToUtcMs(dateYmd, timeHm, offsetMinutes)

  for (let i = 0; i < 3; i++) {
    const refined = tzLocalYmdAndOffset(utcMs, tzName).offsetMinutes
    if (refined === offsetMinutes) break
    offsetMinutes = refined
    utcMs = localCalendarYmdHmToUtcMs(dateYmd, timeHm, offsetMinutes)
  }
  return utcMs
}
