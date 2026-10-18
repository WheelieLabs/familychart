// SPDX-License-Identifier: AGPL-3.0-only

import { getDisplayTimeZone } from "@/lib/display-time-zone"
import { completedCalendarYears } from "@/lib/person/person-age"

export { getDisplayTimeZone, setDisplayTimeZone } from "@/lib/display-time-zone"

/**
 * The one place dates and times are formatted for display. Locale is a constant, never the browser's,
 * so the same instant reads the same on every device. Parsing helpers stay in `lib/datetime.ts`.
 *
 * | Function            | Example                     |
 * |---------------------|-----------------------------|
 * | formatDate          | 9 Oct 2026                  |
 * | formatDateShort     | 9 Oct (same year)           |
 * | formatWeekdayDate   | Fri 9 Oct                   |
 * | formatTime          | 7:46 pm                     |
 * | formatDateTime      | 9 Oct 2026, 7:46 pm         |
 * | ...with seconds     | 9 Oct 2026, 10:47:00 pm     |
 * | formatRange         | 2 Oct – 9 Oct 2026          |
 * | formatDobWithAge    | 2 Apr 2015 · 11 yrs         |
 * | formatDateLong      | Friday 9 October 2026       |
 * | formatDateTimeLong  | Friday 9 October 2026, 11:03 pm |
 * | formatMonthYear     | October 2026                |
 * | formatMonthName     | October (month 1 to 12)     |
 *
 * September is "Sept" in the en-AU locale; that is accepted.
 */

const DISPLAY_LOCALE = "en-AU"

/** The locale every date is displayed in. A constant today; a later instance setting changes only this. */
export function getDisplayLocale(): string {
  return DISPLAY_LOCALE
}

/** The timezone this device is set to, for suggesting a default. Never used to display or enter times. */
export function getDeviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** An instant (`Date`, epoch ms or ISO-8601 string) or a calendar date (`YYYY-MM-DD`). */
export type DateInput = Date | number | string

export interface FormatOptions {
  /** IANA zone to display in. Defaults to {@link getDisplayTimeZone}. Ignored for a `YYYY-MM-DD` input. */
  timeZone?: string
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

/** A bare calendar date has no zone, so it is read and printed as UTC and never shifts a day. */
function resolve(input: DateInput, options?: FormatOptions): { date: Date; timeZone: string } {
  if (typeof input === "string" && YMD_RE.test(input.trim())) {
    return { date: new Date(`${input.trim()}T00:00:00Z`), timeZone: "UTC" }
  }
  return { date: new Date(input), timeZone: options?.timeZone ?? getDisplayTimeZone() }
}

function format(date: Date, timeZone: string, parts: Intl.DateTimeFormatOptions): string {
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat(getDisplayLocale(), { timeZone, ...parts }).format(date)
}

const DATE_PARTS: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }
const DAY_MONTH_PARTS: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }

/** `9 Oct 2026` */
export function formatDate(input: DateInput, options?: FormatOptions): string {
  const { date, timeZone } = resolve(input, options)
  return format(date, timeZone, DATE_PARTS)
}

function yearOf(date: Date, timeZone: string): string {
  return format(date, timeZone, { year: "numeric" })
}

/** `9 Oct` in the same year as `now`; the full date (`9 Oct 2025`) otherwise. */
export function formatDateShort(input: DateInput, options?: FormatOptions & { now?: DateInput }): string {
  const { date, timeZone } = resolve(input, options)
  const now = new Date(options?.now ?? Date.now())
  if (yearOf(date, timeZone) !== yearOf(now, timeZone)) {
    return format(date, timeZone, DATE_PARTS)
  }
  return format(date, timeZone, DAY_MONTH_PARTS)
}

/** `Fri 9 Oct` */
export function formatWeekdayDate(input: DateInput, options?: FormatOptions): string {
  const { date, timeZone } = resolve(input, options)
  const weekday = format(date, timeZone, { weekday: "short" })
  return weekday && `${weekday} ${format(date, timeZone, DAY_MONTH_PARTS)}`
}

/** `Friday 9 October 2026`: the date spelled out, for the line under a date input. */
export function formatDateLong(input: DateInput, options?: FormatOptions): string {
  const { date, timeZone } = resolve(input, options)
  const weekday = format(date, timeZone, { weekday: "long" })
  return weekday && `${weekday} ${format(date, timeZone, { day: "numeric", month: "long", year: "numeric" })}`
}

/** `October` for month 1 to 12, for a month picker. */
export function formatMonthName(month: number): string {
  return format(new Date(Date.UTC(2000, month - 1, 1)), "UTC", { month: "long" })
}

/** `October 2026` from a `YYYY-MM` (or any `YYYY-MM-DD`) value: the month heading on the History calendar. */
export function formatMonthYear(yearMonth: string): string {
  const { date, timeZone } = resolve(`${yearMonth.slice(0, 7)}-01`)
  return format(date, timeZone, { month: "long", year: "numeric" })
}

/** Lowercase am/pm with an ordinary space (ICU uses a narrow no-break space). */
function tidyTime(text: string): string {
  return text.replace(/[  ]/g, " ").toLowerCase()
}

/** `7:46 pm`, or `10:47:00 pm` with `seconds`. */
export function formatTime(input: DateInput, options?: FormatOptions & { seconds?: boolean }): string {
  const { date, timeZone } = resolve(input, options)
  const parts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", hour12: true }
  if (options?.seconds) parts.second = "2-digit"
  return tidyTime(format(date, timeZone, parts))
}

/** `9 Oct 2026, 7:46 pm`. The `seconds` option (Audit Log only) gives `9 Oct 2026, 10:47:00 pm`. */
export function formatDateTime(input: DateInput, options?: FormatOptions & { seconds?: boolean }): string {
  const day = formatDate(input, options)
  return day && `${day}, ${formatTime(input, options)}`
}

/** `Friday 9 October 2026, 11:03 pm`: the date and time spelled out, for the line under a date and time pair. */
export function formatDateTimeLong(input: DateInput, options?: FormatOptions): string {
  const day = formatDateLong(input, options)
  return day && `${day}, ${formatTime(input, options)}`
}

/** `2 Oct – 9 Oct 2026`; each end carries its year when the years differ. */
export function formatRange(start: DateInput, end: DateInput, options?: FormatOptions): string {
  const a = resolve(start, options)
  const b = resolve(end, options)
  if (yearOf(a.date, a.timeZone) === yearOf(b.date, b.timeZone)) {
    return `${format(a.date, a.timeZone, DAY_MONTH_PARTS)} – ${format(b.date, b.timeZone, DATE_PARTS)}`
  }
  return `${format(a.date, a.timeZone, DATE_PARTS)} – ${format(b.date, b.timeZone, DATE_PARTS)}`
}

/** `2 Apr 2015 · 11 yrs` from a `YYYY-MM-DD` date of birth. Age is counted in the display zone. */
export function formatDobWithAge(
  dateOfBirth: string,
  options?: FormatOptions & { now?: DateInput },
): string {
  const day = formatDate(dateOfBirth)
  const age = completedCalendarYears(
    dateOfBirth,
    options?.timeZone ?? getDisplayTimeZone(),
    new Date(options?.now ?? Date.now()),
  )
  if (!day || !Number.isFinite(age)) return day
  return `${day} · ${age} ${age === 1 ? "yr" : "yrs"}`
}

/**
 * "just now", "5 min ago", "yesterday", "3 days ago", or the date beyond 30 days; a future instant
 * reads "in 40 min" or "in 3 h 20 min". `now` defaults to the current time.
 */
export function formatElapsed(at: DateInput, options?: FormatOptions & { now?: DateInput }): string {
  const atMs = new Date(at).getTime()
  if (!Number.isFinite(atMs)) return ""
  const nowMs = new Date(options?.now ?? Date.now()).getTime()

  if (atMs > nowMs) {
    const diffMin = Math.round((atMs - nowMs) / 60_000)
    if (diffMin < 1) return "just now"
    const h = Math.floor(diffMin / 60)
    const m = diffMin % 60
    return `in ${h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`}`
  }

  const deltaSec = Math.round((nowMs - atMs) / 1000)
  if (deltaSec < 45) return "just now"
  if (deltaSec < 90) return "1 min ago"
  if (deltaSec < 3600) return `${Math.round(deltaSec / 60)} min ago`
  if (deltaSec < 5400) return "1 hour ago"
  if (deltaSec < 86400) return `${Math.round(deltaSec / 3600)} hours ago`
  if (deltaSec < 172800) return "yesterday"
  const days = Math.round(deltaSec / 86400)
  if (days < 30) return `${days} days ago`
  return formatDate(atMs, options)
}
