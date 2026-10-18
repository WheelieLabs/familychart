// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Schedule recurrence computation: when is a prescription schedule active,
 * what dosage applies to a given slot.
 *
 * Callers: cron.ts, dashboard-issue-builders.ts, slot-outcomes.ts. Which slot a dose belongs to is stored
 * in slot outcomes, not worked out here.
 * No HTTP or DB dependencies — pure schedule calendar logic.
 */

import { parseHHMM, formatHHMM, localCalendarYmdHmToUtcMs, utcMsToLocalYmd } from "@/lib/datetime"

export type MedScheduleFreq =
  | { kind: "daily" }
  | { kind: "every_n_days"; n: number }
  | { kind: "weekly"; weekdays: number[] }

/** One scheduled clock time with dose amount (medication catalogue unit). */
export interface MedScheduleSlot {
  time: string
  dosage: number
}

export function parseScheduleTimesJson(raw: string | null): string[] {
  if (raw == null || raw === "") return []
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return v.filter((x): x is string => typeof x === "string")
  } catch {
    return []
  }
}

export function parseScheduleSlotsJson(raw: string | null): MedScheduleSlot[] {
  if (raw == null || raw === "") return []
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    const out: MedScheduleSlot[] = []
    for (const item of v) {
      if (typeof item !== "object" || item === null) continue
      const o = item as Record<string, unknown>
      const timeRaw = typeof o.time === "string" ? o.time.trim() : ""
      const hm = parseHHMM(timeRaw)
      if (!hm) continue
      const d =
        typeof o.dosage === "number"
          ? o.dosage
          : typeof o.dosage === "string"
            ? parseFloat(o.dosage)
            : NaN
      if (!Number.isFinite(d) || d <= 0) continue
      out.push({ time: formatHHMM(hm.h, hm.m), dosage: d })
    }
    const byTime = new Map<string, number>()
    for (const s of out) byTime.set(s.time, s.dosage)
    return [...byTime.entries()]
      .map(([time, dosage]) => ({ time, dosage }))
      .sort((a, b) => a.time.localeCompare(b.time))
  } catch {
    return []
  }
}

export function parseScheduleFrequencyJson(raw: string | null): MedScheduleFreq | null {
  if (raw == null || raw.trim() === "") return null
  try {
    const v = JSON.parse(raw) as Record<string, unknown>
    const kind = v.kind
    if (kind === "daily") return { kind: "daily" }
    if (kind === "every_n_days") {
      const n = typeof v.n === "number" ? v.n : parseInt(String(v.n), 10)
      if (!Number.isFinite(n) || n < 2) throw new Error("every_n_days requires n >= 2")
      return { kind: "every_n_days", n: Math.floor(n) }
    }
    if (kind === "weekly") {
      const wd = v.weekdays
      if (!Array.isArray(wd) || wd.length === 0) throw new Error("weekly requires non-empty weekdays")
      const days: number[] = []
      for (const x of wd) {
        const d = typeof x === "number" ? x : parseInt(String(x), 10)
        if (!Number.isFinite(d) || d < 0 || d > 6) throw new Error("weekdays must be 0–6 (Sun–Sat)")
        days.push(d)
      }
      return { kind: "weekly", weekdays: [...new Set(days)].sort((a, b) => a - b) }
    }
    throw new Error("Invalid schedule frequency kind")
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Invalid")) throw e
    throw new Error("Invalid schedule_frequency JSON")
  }
}

export function parseScheduleFrequencyUnknown(raw: unknown): MedScheduleFreq {
  if (raw == null) return { kind: "daily" }
  if (typeof raw === "string") {
    const t = raw.trim()
    if (t === "") return { kind: "daily" }
    return parseScheduleFrequencyJson(t) ?? { kind: "daily" }
  }
  if (typeof raw === "object" && raw !== null) {
    if (Object.keys(raw as object).length === 0) return { kind: "daily" }
    return parseScheduleFrequencyJson(JSON.stringify(raw)) ?? { kind: "daily" }
  }
  throw new Error("Invalid schedule_frequency")
}

export function stringifyScheduleFrequency(freq: MedScheduleFreq): string {
  return JSON.stringify(freq)
}

/** Parse a `YYYY-MM-DD` string as a local-timezone midnight Date. */
export function parseYmdToLocalDate(ymd: string): Date {
  const parts = ymd.trim().split("-").map(Number)
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) {
    throw new Error("Invalid date")
  }
  const [y, mo, d] = parts
  return new Date(y, mo - 1, d, 0, 0, 0, 0)
}

/** Weekday (Sun=0) for a civil `YYYY-MM-DD`, independent of viewer timezone. */
export function weekdayJsSun0FromIsoYmd(ymd: string): number {
  return new Date(`${ymd}T12:00:00.000Z`).getUTCDay()
}

function fullDaysBetweenIsoYmd(startYmd: string, ymd: string): number {
  const a = new Date(`${startYmd}T00:00:00.000Z`).getTime()
  const b = new Date(`${ymd}T00:00:00.000Z`).getTime()
  return Math.round((b - a) / 86400000)
}

/** Inclusive start/end in local calendar; end optional. */
function isScheduleActiveOnLocalDate(
  freq: MedScheduleFreq | null,
  scheduleStart: string | null,
  scheduleEnd: string | null,
  localDay: Date
): boolean {
  if (!freq) return false
  if (!scheduleStart || scheduleStart.trim() === "") return false

  const start = parseYmdToLocalDate(scheduleStart)
  const endOfLocalDay = new Date(localDay.getFullYear(), localDay.getMonth(), localDay.getDate(), 23, 59, 59, 999)
  if (localDay.getTime() < start.getTime()) return false
  if (scheduleEnd != null && scheduleEnd.trim() !== "") {
    const end = parseYmdToLocalDate(scheduleEnd)
    const lastMoment = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999)
    if (endOfLocalDay.getTime() > lastMoment.getTime()) return false
  }

  if (freq.kind === "daily") return true

  if (freq.kind === "weekly") {
    return freq.weekdays.includes(localDay.getDay())
  }

  const dayMs = 86400000
  const startUtcMs = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  const localUtcMs = Date.UTC(localDay.getFullYear(), localDay.getMonth(), localDay.getDate())
  const diff = Math.round((localUtcMs - startUtcMs) / dayMs)
  if (diff < 0) return false
  return diff % freq.n === 0
}

/**
 * Same rules as {@link isScheduleActiveOnLocalDate} for a civil calendar date string
 * (`YYYY-MM-DD`). Use with dates from the client so recurrence matches the browser calendar.
 */
/**
 * Whether an assignment's schedule is in effect on a day, regardless of which weekday or interval
 * day it falls on: it has started and has not ended. A schedule with no start date only counts when
 * daily (the same rule as `isScheduleActiveOnYmd`). Used to ask "is this medication scheduled?",
 * where a weekly schedule on an off day is still scheduled.
 */
export function isScheduleInEffectOnYmd(
  freq: MedScheduleFreq | null,
  scheduleStart: string | null,
  scheduleEnd: string | null,
  ymd: string
): boolean {
  if (!freq) return false
  const startRaw = scheduleStart?.trim() ?? ""
  if (startRaw === "") return freq.kind === "daily"
  if (ymd < startRaw) return false
  const endRaw = scheduleEnd?.trim() ?? ""
  return endRaw === "" || ymd <= endRaw
}

export function isScheduleActiveOnYmd(
  freq: MedScheduleFreq | null,
  scheduleStart: string | null,
  scheduleEnd: string | null,
  ymd: string
): boolean {
  if (!freq) return false

  const startRaw = scheduleStart?.trim() ?? ""
  if (startRaw === "") {
    return freq.kind === "daily"
  }

  if (ymd < startRaw) return false
  const endRaw = scheduleEnd?.trim() ?? ""
  if (endRaw !== "" && ymd > endRaw) return false

  if (freq.kind === "daily") return true

  if (freq.kind === "weekly") {
    return freq.weekdays.includes(weekdayJsSun0FromIsoYmd(ymd))
  }

  const diff = fullDaysBetweenIsoYmd(startRaw, ymd)
  if (diff < 0) return false
  return diff % freq.n === 0
}

/** Dosage for a scheduled time slot; falls back to `fallbackDosage` or 1. */
export function dosageForScheduledTime(
  timeHm: string,
  slotsJson: string | null,
  fallbackDosage: number | null
): number {
  const slots = parseScheduleSlotsJson(slotsJson)
  const hit = slots.find(s => s.time === timeHm)
  if (hit) return hit.dosage
  if (fallbackDosage != null && Number.isFinite(fallbackDosage) && fallbackDosage > 0) return fallbackDosage
  return 1
}
