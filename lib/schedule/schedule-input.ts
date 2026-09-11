// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Schedule input normalisation and validation for HTTP route handlers.
 * Converts raw API bodies into the JSON column values written to person_medications.
 *
 * Callers: app/api/people/[id]/person-medications/route.ts
 * No DB dependency — pure parse/validate/serialize logic.
 */

import { parseHHMM, formatHHMM } from "@/lib/datetime"
import {
  type MedScheduleFreq,
  type MedScheduleSlot,
  parseScheduleTimesJson,
  parseScheduleSlotsJson,
  parseScheduleFrequencyUnknown,
  parseYmdToLocalDate,
  stringifyScheduleFrequency,
} from "@/lib/schedule/schedule-recurrence"

export type { MedScheduleFreq, MedScheduleSlot }

function fallbackDosageAmount(defaultDosage: number | null): number {
  if (defaultDosage != null && Number.isFinite(defaultDosage) && defaultDosage > 0) return defaultDosage
  return 1
}

function normalizeScheduleTimeStrings(input: unknown[]): string[] {
  const out: string[] = []
  for (const x of input) {
    if (typeof x !== "string") continue
    const hm = parseHHMM(x.trim())
    if (!hm) throw new Error(`Invalid time: ${x}`)
    out.push(formatHHMM(hm.h, hm.m))
  }
  return [...new Set(out)].sort((a, b) => a.localeCompare(b))
}

/** Normalise client POST/PATCH `schedule_slots` array; throws on invalid entries. */
function normalizeScheduleSlotsInput(input: unknown, defaultDosage: number | null): MedScheduleSlot[] {
  if (!Array.isArray(input)) throw new Error("schedule_slots must be an array")
  const fb = fallbackDosageAmount(defaultDosage)
  const tmp: MedScheduleSlot[] = []
  for (const item of input) {
    if (typeof item !== "object" || item === null) throw new Error("Invalid schedule_slots entry")
    const o = item as Record<string, unknown>
    const timeRaw = typeof o.time === "string" ? o.time.trim() : ""
    const hm = parseHHMM(timeRaw)
    if (!hm) throw new Error(`Invalid schedule_slots time: ${timeRaw}`)
    let d =
      typeof o.dosage === "number"
        ? o.dosage
        : o.dosage != null && o.dosage !== ""
          ? parseFloat(String(o.dosage))
          : fb
    if (!Number.isFinite(d) || d <= 0) throw new Error("schedule_slots dosage must be a positive number")
    tmp.push({ time: formatHHMM(hm.h, hm.m), dosage: d })
  }
  const byTime = new Map<string, number>()
  for (const s of tmp) byTime.set(s.time, s.dosage)
  return [...byTime.entries()]
    .map(([time, dosage]) => ({ time, dosage }))
    .sort((a, b) => a.time.localeCompare(b.time))
}

function slotsToTimesSorted(slots: MedScheduleSlot[]): string[] {
  return [...new Set(slots.map(s => s.time))].sort((a, b) => a.localeCompare(b))
}

/**
 * PATCH merge: `schedule_slots` in body wins; else `schedule_times` with dosages merged from stored slots; else stored.
 */
export function resolveTimesAndSlotsForPersonMedicationPatch(
  body: Record<string, unknown>,
  storedTimesJson: string | null,
  storedSlotsJson: string | null,
  defaultDosage: number | null
): { times: string[]; slots: MedScheduleSlot[] } {
  const fb = fallbackDosageAmount(defaultDosage)
  let storedTimes: string[] = []
  try {
    storedTimes = normalizeScheduleTimeStrings(parseScheduleTimesJson(storedTimesJson))
  } catch {
    storedTimes = []
  }
  const storedSlots = parseScheduleSlotsJson(storedSlotsJson)

  if (Array.isArray(body.schedule_slots)) {
    const slots = normalizeScheduleSlotsInput(body.schedule_slots, defaultDosage)
    return { times: slotsToTimesSorted(slots), slots }
  }
  if (Array.isArray(body.schedule_times)) {
    const times = normalizeScheduleTimeStrings(body.schedule_times as unknown[])
    const slots = times.map(t => {
      const hit = storedSlots.find(s => s.time === t)
      return { time: t, dosage: hit?.dosage ?? fb }
    })
    return { times, slots }
  }

  const slots =
    storedSlots.length > 0
      ? storedTimes.map(t => {
          const hit = storedSlots.find(s => s.time === t)
          return { time: t, dosage: hit?.dosage ?? fb }
        })
      : storedTimes.map(t => ({ time: t, dosage: fb }))
  return { times: storedTimes, slots }
}

export function resolveTimesAndSlotsForPersonMedicationPost(
  body: Record<string, unknown>,
  defaultDosage: number | null
): { times: string[]; slots: MedScheduleSlot[] } {
  const fb = fallbackDosageAmount(defaultDosage)
  if (Array.isArray(body.schedule_slots)) {
    const slots = normalizeScheduleSlotsInput(body.schedule_slots, defaultDosage)
    return { times: slotsToTimesSorted(slots), slots }
  }
  if (Array.isArray(body.schedule_times)) {
    const times = normalizeScheduleTimeStrings(body.schedule_times as unknown[])
    const slots = times.map(t => ({ time: t, dosage: fb }))
    return { times, slots }
  }
  return { times: [], slots: [] }
}

export function validateMedicationScheduleInput(
  timesNormalized: string[],
  freqRaw: unknown,
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  slotsNormalized: MedScheduleSlot[] | null
): {
  timesJson: string | null
  slotsJson: string | null
  frequencyJson: string | null
  start: string | null
  end: string | null
} {
  if (timesNormalized.length === 0) {
    return { timesJson: null, slotsJson: null, frequencyJson: null, start: null, end: null }
  }

  if (!startDate || startDate.trim() === "") {
    throw new Error("schedule_start_date is required when schedule times are set")
  }

  const freq = parseScheduleFrequencyUnknown(freqRaw)

  if (freq.kind === "twice_daily" && timesNormalized.length !== 2) {
    throw new Error("twice_daily requires exactly two scheduled times")
  }

  parseYmdToLocalDate(startDate)
  let end: string | null = endDate?.trim() || null
  if (end) {
    parseYmdToLocalDate(end)
    const s = parseYmdToLocalDate(startDate)
    const e = parseYmdToLocalDate(end)
    if (e.getTime() < s.getTime()) throw new Error("schedule_end_date must be on or after schedule_start_date")
  }

  let slotsJson: string | null = null
  if (timesNormalized.length > 0) {
    if (!slotsNormalized || slotsNormalized.length === 0) {
      throw new Error("Internal error: schedule slots missing for non-empty times")
    }
    const sortedTimes = [...timesNormalized].sort((a, b) => a.localeCompare(b))
    const slotTimes = slotsToTimesSorted(slotsNormalized)
    if (sortedTimes.length !== slotTimes.length || sortedTimes.some((t, i) => t !== slotTimes[i])) {
      throw new Error("schedule_slots times must match schedule_times")
    }
    slotsJson = JSON.stringify(
      [...slotsNormalized].sort((a, b) => a.time.localeCompare(b.time))
    )
  }

  return {
    timesJson: JSON.stringify(timesNormalized),
    slotsJson,
    frequencyJson: stringifyScheduleFrequency(freq),
    start: startDate.trim(),
    end,
  }
}
