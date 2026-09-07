// SPDX-License-Identifier: AGPL-3.0-only

import type { CalendarContext } from "@/lib/calendar-context"
import { ianaLocalYmdHmToUtcMs, localCalendarYmdHmToUtcMs, parseHHMM, formatHHMM, utcMsToLocalYmd, tzLocalYmdAndOffset } from "@/lib/datetime"
import {
  isScheduleActiveOnYmd,
  parseScheduleTimesJson,
  parseScheduleFrequencyUnknown,
  dosageForScheduledTime,
  type MedScheduleFreq,
} from "@/lib/schedule/schedule-recurrence"

export interface SlotEvaluatorConfig {
  leadMs: number
  slotWindowMs: number
  graceMs: number
  overdueOffsetMs: number
}

export type SlotStatus = "upcoming" | "due" | "overdue" | "overdue_push" | "suppressed" | "inactive"

/**
 * Resolve slot epoch ms from a CalendarContext — prefers IANA when available,
 * falls back to offset. Replaces the scattered localCalendarYmdHmToUtcMs /
 * ianaLocalYmdHmToUtcMs call pairs that previously diverged between dashboard
 * and cron.
 */
export function resolveSlotMs(ctx: CalendarContext, ymd: string, hhmm: string): number {
  return ctx.ianaTz
    ? ianaLocalYmdHmToUtcMs(ymd, hhmm, ctx.ianaTz)
    : localCalendarYmdHmToUtcMs(ymd, hhmm, ctx.offsetMinutes)
}

export interface SuppressibleScheduleInput {
  scheduleTimes: string[]
  scheduleFrequency: MedScheduleFreq | null
  scheduleStartDate: string | null
  scheduleEndDate: string | null
}

export interface NextSuppressibleSlot {
  hhmm: string
  slotMs: number
}

/**
 * First scheduled HH:mm strictly after `recordedMs`, on `calCtx`'s local calendar day, if the
 * schedule is active that day — via `resolveSlotMs` (IANA when available). The dose must fall
 * on that same local ymd, or within the slot's `isSlotClearedByDose` lead/grace window when
 * `config` is supplied, so a historical stamp cannot cancel today's earliest reminder.
 * Pure; Node-independent (`Intl.DateTimeFormat` with `timeZone` works in-browser), so this is
 * shared by the client preview (record-medication checkbox) and the server INSERT into
 * schedule_reminder_suppressions — previously reimplemented twice with different timezone models.
 */
export function findNextSuppressibleSlot(
  recordedMs: number,
  schedule: SuppressibleScheduleInput,
  calCtx: CalendarContext,
  config?: SlotEvaluatorConfig,
): NextSuppressibleSlot | null {
  const ymd = calCtx.ymd
  if (!isScheduleActiveOnYmd(schedule.scheduleFrequency, schedule.scheduleStartDate, schedule.scheduleEndDate, ymd)) {
    return null
  }
  const recordedYmd = calCtx.ianaTz
    ? tzLocalYmdAndOffset(recordedMs, calCtx.ianaTz).ymd
    : utcMsToLocalYmd(recordedMs, calCtx.offsetMinutes)
  for (const tStr of [...schedule.scheduleTimes].sort()) {
    const hm = parseHHMM(tStr)
    if (!hm) continue
    const hhmm = formatHHMM(hm.h, hm.m)
    const slotMs = resolveSlotMs(calCtx, ymd, hhmm)
    if (slotMs <= recordedMs) continue
    const sameLocalDay = recordedYmd === ymd
    const inClearanceWindow = config != null && isSlotClearedByDose([recordedMs], slotMs, config)
    if (sameLocalDay || inClearanceWindow) return { hhmm, slotMs }
  }
  return null
}

/**
 * Classify a scheduled slot relative to now.
 *
 * Pure — no DB or timezone logic. Suppression is pre-resolved by the caller
 * from schedule_reminder_suppressions.
 *
 * States:
 *   upcoming     — in lead window before slot; dashboard amber, no push
 *   due          — in on-time push window [slot, slot+slotWindowMs]; dashboard red, scheduled push
 *   overdue      — in grace gap (slot+slotWindowMs, slot+overdueOffsetMs); dashboard red, no push
 *   overdue_push — in overdue push window; dashboard red, overdue push
 *   suppressed   — in any active window but slot is suppressed by opt-in
 *   inactive     — outside all windows
 */
export function evaluateScheduledSlot(
  slotMs: number,
  nowMs: number,
  isSuppressed: boolean,
  config: SlotEvaluatorConfig,
): SlotStatus {
  const { leadMs, slotWindowMs, graceMs, overdueOffsetMs } = config
  const afterSlot = nowMs >= slotMs
  const inUpcoming = nowMs >= slotMs - leadMs && nowMs < slotMs
  const inDue = afterSlot && nowMs <= slotMs + slotWindowMs
  const inGrace = afterSlot && nowMs <= slotMs + graceMs
  const overdueStart = slotMs + overdueOffsetMs
  const inOverduePush = nowMs >= overdueStart && nowMs <= overdueStart + slotWindowMs

  if (!inUpcoming && !inGrace && !inOverduePush) return "inactive"
  if (isSuppressed) return "suppressed"
  if (inUpcoming) return "upcoming"
  if (inDue) return "due"
  if (inOverduePush) return "overdue_push"
  return "overdue"
}

/**
 * Proximity-based dose clearance for a scheduled slot.
 *
 * Returns true when any recorded dose falls within the slot's clearance
 * window `[slot − leadMs, slot + graceMs]` — i.e. the slot's full active
 * window. A cleared slot emits no dashboard alert and fires no scheduled /
 * overdue push, because the dose for that slot has already been recorded.
 *
 * This restores the pre-0.37.8 behaviour that the opt-in
 * `schedule_reminder_suppressions` table alone does not cover (that table only
 * suppresses a *future* slot via the explicit "cancel reminder" checkbox).
 *
 * Pure — `doseMsList` is the list of recorded-at epoch ms for the slot's
 * person + medication, pre-loaded by the caller.
 */
export function isSlotClearedByDose(
  doseMsList: readonly number[],
  slotMs: number,
  config: SlotEvaluatorConfig,
): boolean {
  const startMs = slotMs - config.leadMs
  const endMs = slotMs + config.graceMs
  for (const t of doseMsList) {
    if (Number.isFinite(t) && t >= startMs && t <= endMs) return true
  }
  return false
}

/** One person-medication's scheduled-slot row, as seen by {@link collectDueScheduledSlots}. */
export interface ScheduleAssemblyRow {
  personMedicationId: number
  personId: number
  medicationId: number
  scheduleTimesRaw: string | null
  scheduleSlotsRaw: string | null
  scheduleFrequencyRaw: string | null
  scheduleStartDate: string | null
  scheduleEndDate: string | null
  medDefaultDosage: number | null
  /** Pre-resolved by the caller — calendar-fallback strictness (row IANA → instance → offset,
   *  or cron's IANA-required hard gate) is a caller-side policy decision, not this function's. */
  calCtx: CalendarContext
}

export interface DueScheduledSlot {
  personMedicationId: number
  personId: number
  medicationId: number
  ymd: string
  hhmm: string
  scheduledTime: string
  slotMs: number
  status: "upcoming" | "due" | "overdue" | "overdue_push"
  scheduledDosage: number
}

/**
 * Shared scheduled-slot assembly: walks each row's scheduled times across `days`, resolving slot
 * epoch via `resolveSlotMs`, filtering inactive/suppressed/dose-cleared slots. Dashboard and cron
 * both take slots from Alert readiness (`evaluateAlertReadiness`), which walks each row's own
 * local yesterday/today/tomorrow (row IANA → instance IANA → fallback) and a 3-day dose lookback.
 */
export function collectDueScheduledSlots(
  rows: readonly ScheduleAssemblyRow[],
  days: readonly string[],
  nowMs: number,
  cfg: SlotEvaluatorConfig,
  isSuppressed: (personMedicationId: number, ymd: string, hhmm: string) => boolean,
  doseMsFor: (personId: number, medicationId: number) => readonly number[],
): DueScheduledSlot[] {
  const out: DueScheduledSlot[] = []

  for (const row of rows) {
    const times = parseScheduleTimesJson(row.scheduleTimesRaw)
    if (times.length === 0) continue
    const freq = parseScheduleFrequencyUnknown(row.scheduleFrequencyRaw)
    const recordedDoseMs = doseMsFor(row.personId, row.medicationId)

    for (const tStr of times) {
      const hm = parseHHMM(tStr)
      if (!hm) continue
      const hhmm = formatHHMM(hm.h, hm.m)

      for (const ymd of days) {
        if (!isScheduleActiveOnYmd(freq, row.scheduleStartDate, row.scheduleEndDate, ymd)) continue

        const slotMs = resolveSlotMs(row.calCtx, ymd, hhmm)
        if (!Number.isFinite(slotMs)) continue

        const suppressed = isSuppressed(row.personMedicationId, ymd, hhmm)
        const status = evaluateScheduledSlot(slotMs, nowMs, suppressed, cfg)
        if (status === "inactive" || status === "suppressed") continue
        if (isSlotClearedByDose(recordedDoseMs, slotMs, cfg)) continue

        out.push({
          personMedicationId: row.personMedicationId,
          personId: row.personId,
          medicationId: row.medicationId,
          ymd,
          hhmm,
          scheduledTime: tStr,
          slotMs,
          status,
          scheduledDosage: dosageForScheduledTime(tStr, row.scheduleSlotsRaw, row.medDefaultDosage),
        })
      }
    }
  }

  return out
}
