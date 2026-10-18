// SPDX-License-Identifier: AGPL-3.0-only

import { parseScheduleTimeUserInput } from "@/lib/datetime"

export interface DoseExpectationInput {
  slotHhmm: string
  startDate: string
  endDate: string
  /** null = every day in range. */
  weekdays: number[] | null
}

export type DoseExpectationValidation =
  | { ok: true; value: DoseExpectationInput }
  | { ok: false; error: string }

/** A real Gregorian calendar date as `YYYY-MM-DD`, else null. */
export function parseLocalYmd(raw: unknown): string | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const [y, m, d] = raw.split("-").map(s => parseInt(s, 10))
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? raw : null
}

/**
 * Validates a parent-entered expectation: the slot must be one of the medication's scheduled dose
 * times, the term range a real date range, and weekdays JS day numbers (0 = Sunday). Dates are
 * always typed in by the parent — never read from an external calendar.
 */
export function validateDoseExpectationInput(
  raw: unknown,
  scheduleTimes: readonly string[],
): DoseExpectationValidation {
  if (raw == null || typeof raw !== "object") return { ok: false, error: "Invalid body" }
  const body = raw as Record<string, unknown>

  const slot = typeof body.slot_hhmm === "string" ? parseScheduleTimeUserInput(body.slot_hhmm) : null
  if (!slot || !scheduleTimes.includes(slot)) {
    return { ok: false, error: "slot_hhmm must be one of the scheduled dose times" }
  }

  const startDate = parseLocalYmd(body.start_date)
  if (!startDate) return { ok: false, error: "start_date must be a valid date (YYYY-MM-DD)" }
  const endDate = parseLocalYmd(body.end_date)
  if (!endDate) return { ok: false, error: "end_date must be a valid date (YYYY-MM-DD)" }
  if (endDate < startDate) return { ok: false, error: "end_date must not be before start_date" }

  let weekdays: number[] | null = null
  if (body.weekdays != null) {
    const list = body.weekdays
    if (!Array.isArray(list) || !list.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
      return { ok: false, error: "weekdays must be whole numbers from 0 (Sunday) to 6 (Saturday)" }
    }
    const unique = [...new Set(list as number[])].sort((a, b) => a - b)
    weekdays = unique.length === 0 || unique.length === 7 ? null : unique
  }

  return { ok: true, value: { slotHhmm: slot, startDate, endDate, weekdays } }
}
