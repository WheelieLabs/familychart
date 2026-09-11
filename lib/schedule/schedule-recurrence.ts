// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Schedule recurrence computation: when is a prescription schedule active,
 * which slot does a dose record match, what dosage applies to a given slot.
 *
 * Callers: cron.ts, dashboard-issue-builders.ts, app/api/records/route.ts
 * No HTTP or DB dependencies — pure schedule calendar logic.
 */

import { parseHHMM, formatHHMM, localCalendarYmdHmToUtcMs, utcMsToLocalYmd } from "@/lib/datetime"
import type { ScheduleSlotMatchConfig } from "@/lib/schedule/schedule-config"
import { PUSH_DELIVERY_WINDOW_MINUTES } from "@/lib/schedule/schedule-config"

export type MedScheduleFreq =
  | { kind: "daily" }
  | { kind: "twice_daily" }
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
    if (kind === "twice_daily") return { kind: "twice_daily" }
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
function weekdayJsSun0FromIsoYmd(ymd: string): number {
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

  if (freq.kind === "daily" || freq.kind === "twice_daily") return true

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
export function isScheduleActiveOnYmd(
  freq: MedScheduleFreq | null,
  scheduleStart: string | null,
  scheduleEnd: string | null,
  ymd: string
): boolean {
  if (!freq) return false

  const startRaw = scheduleStart?.trim() ?? ""
  if (startRaw === "") {
    return freq.kind === "daily" || freq.kind === "twice_daily"
  }

  if (ymd < startRaw) return false
  const endRaw = scheduleEnd?.trim() ?? ""
  if (endRaw !== "" && ymd > endRaw) return false

  if (freq.kind === "daily" || freq.kind === "twice_daily") return true

  if (freq.kind === "weekly") {
    return freq.weekdays.includes(weekdayJsSun0FromIsoYmd(ymd))
  }

  const diff = fullDaysBetweenIsoYmd(startRaw, ymd)
  if (diff < 0) return false
  return diff % freq.n === 0
}

function defaultSlotMatchConfig(): ScheduleSlotMatchConfig {
  return {
    associationRadiusMs: 60 * 60 * 1000,
    lateGraceMs: PUSH_DELIVERY_WINDOW_MINUTES * 60_000,
  }
}

function slotInstantsOnYmd(
  localYmd: string,
  timesHm: string[],
  timezoneOffsetMinutes: number,
): Array<{ utcMs: number; label: string }> {
  const slots: Array<{ utcMs: number; label: string }> = []
  for (const t of timesHm) {
    const hm = parseHHMM(t)
    if (!hm) continue
    const label = formatHHMM(hm.h, hm.m)
    const utcMs = localCalendarYmdHmToUtcMs(localYmd, label, timezoneOffsetMinutes)
    if (!Number.isFinite(utcMs)) continue
    slots.push({ utcMs, label })
  }
  return slots.sort((a, b) => a.utcMs - b.utcMs)
}

export function matchRecordToScheduledSlot(
  recordedAt: Date,
  timesHm: string[],
  freq: MedScheduleFreq | null,
  scheduleStart: string | null,
  scheduleEnd: string | null,
  timezoneOffsetMinutes: number,
  matchConfig: ScheduleSlotMatchConfig = defaultSlotMatchConfig(),
): { slotTimeLabel: string; late: boolean } | null {
  if (timesHm.length === 0 || !freq) return null

  const localYmd = utcMsToLocalYmd(recordedAt.getTime(), timezoneOffsetMinutes)

  if (!isScheduleActiveOnYmd(freq, scheduleStart, scheduleEnd, localYmd)) {
    return null
  }

  const slots = slotInstantsOnYmd(localYmd, timesHm, timezoneOffsetMinutes)
  if (slots.length === 0) return null

  const t = recordedAt.getTime()
  let best: (typeof slots)[number] | null = null
  let bestDiff = Infinity
  for (const s of slots) {
    const diff = Math.abs(t - s.utcMs)
    if (diff > matchConfig.associationRadiusMs) continue
    if (diff < bestDiff) {
      bestDiff = diff
      best = s
    }
  }
  if (best == null) return null

  const late = t > best.utcMs + matchConfig.lateGraceMs
  return { slotTimeLabel: best.label, late }
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
