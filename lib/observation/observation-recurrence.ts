// SPDX-License-Identifier: AGPL-3.0-only

import { addCalendarDaysToIsoYmd, formatHHMM, localCalendarYmdHmToUtcMs, parseHHMM, tzLocalYmdAndOffset, utcMsToLocalYmd } from "@/lib/datetime"
import { isValidIanaTz } from "@/lib/settings/registry"

export type ObservationCadence = "daily" | "weekly" | "monthly" | "yearly" | "custom_days"

export interface PersonObservationExpectationRow {
  id: number
  person_id: number
  observation_type: string
  cadence: ObservationCadence
  interval_days: number | null
  recurrence_day_of_month: number | null
  recurrence_month: number | null
  recurrence_day: number | null
  recurrence_use_birthday: number
  enabled: number
  /** Local wall time `HH:mm`; null/empty treated as `00:00`. */
  due_time_hhmm: string | null
  /** IANA timezone name for this schedule (e.g. "Europe/London"). Null → instance default (Layer C). */
  tz: string | null
}

/** Client calendar context from `dashboardScheduleHeaders()` / `resolveCalendarContext()`. */
export interface ObservationScheduleContext {
  now: Date
  tzOffsetMinutes: number
  localTodayYmd: string
}

export function normalizeObservationDueTimeHhmm(
  row: Pick<PersonObservationExpectationRow, "due_time_hhmm">,
): string {
  const t = row.due_time_hhmm?.trim()
  if (!t) return "00:00"
  const p = parseHHMM(t)
  return p ? formatHHMM(p.h, p.m) : "00:00"
}

function daysInMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()
}

function clampDom(y: number, m0: number, dom: number): number {
  const dim = daysInMonth(y, m0)
  return Math.min(Math.max(1, dom), dim)
}

function dueInstantMs(ymd: string, dueHm: string, tz: number): number {
  return localCalendarYmdHmToUtcMs(ymd, dueHm, tz)
}

function nextMonthlyDomAfterMs(lastMs: number, dom: number, dueHm: string, tz: number): number | null {
  const startParsed = parseYmd(utcMsToLocalYmd(lastMs, tz))
  if (!startParsed) return null
  let y = startParsed.y
  let m0 = startParsed.m - 1
  for (let guard = 0; guard < 1200; guard++) {
    const cd = clampDom(y, m0, dom)
    const ymd = `${y}-${String(m0 + 1).padStart(2, "0")}-${String(cd).padStart(2, "0")}`
    const cand = dueInstantMs(ymd, dueHm, tz)
    if (Number.isFinite(cand) && cand > lastMs) return cand
    m0++
    if (m0 > 11) {
      m0 = 0
      y++
    }
  }
  return null
}

function nextYearlyAfterMs(lastMs: number, month: number, day: number, dueHm: string, tz: number): number | null {
  const startParsed = parseYmd(utcMsToLocalYmd(lastMs, tz))
  if (!startParsed) return null
  let y = startParsed.y
  for (let guard = 0; guard < 400; guard++) {
    const dim = daysInMonth(y, month - 1)
    const d = month === 2 && day === 29 && dim < 29 ? 28 : Math.min(day, dim)
    const ymd = `${y}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    const cand = dueInstantMs(ymd, dueHm, tz)
    if (Number.isFinite(cand) && cand > lastMs) return cand
    y++
  }
  return null
}

function resolveNextDueScheduleContext(
  row: Pick<PersonObservationExpectationRow, "tz">,
  ctx: ObservationScheduleContext,
  instanceIanaTz?: string | null,
): ObservationScheduleContext {
  const rowTz = row.tz?.trim()
  const effectiveTz =
    rowTz && isValidIanaTz(rowTz)
      ? rowTz
      : instanceIanaTz?.trim() && isValidIanaTz(instanceIanaTz)
        ? instanceIanaTz.trim()
        : null
  if (!effectiveTz) return ctx
  const { ymd, offsetMinutes } = tzLocalYmdAndOffset(ctx.now.getTime(), effectiveTz)
  return { now: ctx.now, tzOffsetMinutes: offsetMinutes, localTodayYmd: ymd }
}

/**
 * Next scheduled anchor instant strictly after `lastRecorded`.
 */
export function nextDueAfter(
  lastRecorded: Date | null,
  row: Pick<
    PersonObservationExpectationRow,
    | "cadence"
    | "interval_days"
    | "recurrence_day_of_month"
    | "recurrence_month"
    | "recurrence_day"
    | "recurrence_use_birthday"
    | "due_time_hhmm"
    | "tz"
  >,
  dateOfBirth: string | null,
  ctx: ObservationScheduleContext,
  instanceIanaTz?: string | null,
): Date | null {
  const schedCtx = resolveNextDueScheduleContext(row, ctx, instanceIanaTz)
  const dueHm = normalizeObservationDueTimeHhmm(row)
  const tz = schedCtx.tzOffsetMinutes
  const todayYmd = schedCtx.localTodayYmd

  if (row.cadence === "daily") {
    if (!lastRecorded) {
      const t = dueInstantMs(todayYmd, dueHm, tz)
      return Number.isFinite(t) ? new Date(t) : null
    }
    const lastYmd = utcMsToLocalYmd(lastRecorded.getTime(), tz)
    const nextYmd = addCalendarDaysToIsoYmd(lastYmd, 1)
    const ms = dueInstantMs(nextYmd, dueHm, tz)
    return Number.isFinite(ms) ? new Date(ms) : null
  }

  if (row.cadence === "weekly" || row.cadence === "custom_days") {
    const idays = row.interval_days
    if (lastRecorded == null || idays == null || !Number.isFinite(idays) || idays <= 0) return null
    const ms = idays * 24 * 60 * 60 * 1000
    return new Date(lastRecorded.getTime() + ms)
  }

  if (row.cadence === "monthly") {
    let dom: number | null = null
    if (row.recurrence_use_birthday) {
      if (!dateOfBirth) return null
      const p = parseYmd(dateOfBirth)
      if (!p) return null
      dom = p.d
    } else {
      dom = row.recurrence_day_of_month
    }
    if (dom == null || dom < 1 || dom > 31) return null
    const baseMs = lastRecorded?.getTime() ?? 0
    const ms = nextMonthlyDomAfterMs(baseMs, dom, dueHm, tz)
    return ms != null ? new Date(ms) : null
  }

  if (row.cadence === "yearly") {
    let month: number | null = null
    let day: number | null = null
    if (row.recurrence_use_birthday) {
      if (!dateOfBirth) return null
      const p = parseYmd(dateOfBirth)
      if (!p) return null
      month = p.m
      day = p.d
    } else {
      month = row.recurrence_month
      day = row.recurrence_day
    }
    if (month == null || day == null || month < 1 || month > 12 || day < 1 || day > 31) return null
    const baseMs = lastRecorded?.getTime() ?? 0
    const ms = nextYearlyAfterMs(baseMs, month, day, dueHm, tz)
    return ms != null ? new Date(ms) : null
  }

  return null
}

export function parseYmd(isoDate: string): { y: number; m: number; d: number } | null {
  const t = isoDate.trim()
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const y = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10)
  const d = parseInt(m[3], 10)
  if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return { y, m: mo, d }
}

/**
 * Whether an expectation is overdue at `now`.
 * Timezone: stored `row.tz` when set, else `instanceIanaTz` (Layer C). No overdue when neither is set.
 * `lastObsIso` = MAX(recorded_at) for that type, or null if never.
 */
export function isObservationOverdue(
  lastObsIso: string | null,
  row: PersonObservationExpectationRow,
  dateOfBirth: string | null,
  now: Date,
  instanceIanaTz?: string | null,
): boolean {
  if (!row.enabled) return false

  const rowTz = row.tz?.trim()
  const effectiveTz =
    rowTz && isValidIanaTz(rowTz) ? rowTz : instanceIanaTz?.trim() && isValidIanaTz(instanceIanaTz) ? instanceIanaTz.trim() : null
  if (!effectiveTz) return false

  const { ymd: todayYmd, offsetMinutes: tz } = tzLocalYmdAndOffset(now.getTime(), effectiveTz)

  const ctx: ObservationScheduleContext = { now, tzOffsetMinutes: tz, localTodayYmd: todayYmd }

  const last = lastObsIso ? new Date(lastObsIso) : null
  const nowMs = now.getTime()
  const dueHm = normalizeObservationDueTimeHhmm(row)

  if (row.cadence === "daily") {
    if (!last) {
      const dueMs = dueInstantMs(todayYmd, dueHm, tz)
      return Number.isFinite(dueMs) && nowMs >= dueMs
    }
    const lastYmd = utcMsToLocalYmd(last.getTime(), tz)
    if (lastYmd >= todayYmd) return false
    const obligationYmd = addCalendarDaysToIsoYmd(lastYmd, 1)
    const dueMs = dueInstantMs(obligationYmd, dueHm, tz)
    return Number.isFinite(dueMs) && nowMs >= dueMs
  }

  if (row.cadence === "weekly" || row.cadence === "custom_days") {
    const idays = row.interval_days
    if (idays == null || !Number.isFinite(idays) || idays <= 0) return false
    if (!last) return true
    const ms = idays * 24 * 60 * 60 * 1000
    return nowMs - last.getTime() >= ms
  }

  if (!last) return true

  const next = nextDueAfter(last, row, dateOfBirth, ctx, instanceIanaTz)
  if (!next) return false
  return nowMs > next.getTime()
}

export function overdueMessage(type: string): string {
  return `${type} observation overdue`
}

/** For display on settings GET — next anchor after last observation, or first anchor from “now” if never recorded. */
export function nextDueDisplay(
  lastObsIso: string | null,
  row: PersonObservationExpectationRow,
  dateOfBirth: string | null,
  ctx: ObservationScheduleContext,
  instanceIanaTz?: string | null,
): Date | null {
  const last = lastObsIso ? new Date(lastObsIso) : null
  const ref = last ?? new Date(ctx.now.getTime() - 1)
  return nextDueAfter(ref, row, dateOfBirth, ctx, instanceIanaTz)
}
