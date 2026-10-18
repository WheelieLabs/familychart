// SPDX-License-Identifier: AGPL-3.0-only

/**
 * How a dose's timing against its slot reads on screen. Pure, so History, the medication timeline
 * and the tests all say the same thing. Only exceptions are marked: On time (and a dose confirmed
 * given away from home, which carries no timing label) show nothing here.
 */

import { formatTime } from "@/lib/date-format"
import type { SlotOutcome } from "@/lib/schedule/slot-outcomes"

/** The timing result of one attached dose, as the records API and dashboard send it. */
export interface DoseTiming {
  result: "on_time" | "early" | "late"
  /** Minutes from the slot to the dose; negative when early. */
  offsetMinutes: number
  /** The slot it was attached to, "HH:mm" on the schedule's Calendar day. */
  slotHhmm: string
}

/** Narrows a stored outcome to the timing of its attached dose; null for Missed, "given" and unattached. */
export function doseTimingFromOutcome(
  o: Pick<SlotOutcome, "result" | "offsetMinutes" | "slotHhmm" | "recordId">,
): DoseTiming | null {
  if (o.recordId == null || o.offsetMinutes == null) return null
  if (o.result !== "on_time" && o.result !== "early" && o.result !== "late") return null
  return { result: o.result, offsetMinutes: o.offsetMinutes, slotHhmm: o.slotHhmm }
}

/** A slot time "08:00" as `8:00 am`, read as the schedule's own wall clock (no zone shift). */
export function formatSlotHhmm(hhmm: string): string {
  return formatTime(new Date(`1970-01-01T${hhmm}:00Z`), { timeZone: "UTC" })
}

/** "41 min", or "1 h 5 min" from an hour up. */
export function formatGap(minutes: number): string {
  const m = Math.max(0, Math.round(Math.abs(minutes)))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`
}

/** The badge text for an exception ("41 min late", "38 min early"); null for On time. */
export function timingBadgeLabel(t: Pick<DoseTiming, "result" | "offsetMinutes"> | null | undefined): string | null {
  if (!t || t.result === "on_time") return null
  return t.result === "late" ? `${formatGap(t.offsetMinutes)} late` : `${formatGap(t.offsetMinutes)} early`
}
