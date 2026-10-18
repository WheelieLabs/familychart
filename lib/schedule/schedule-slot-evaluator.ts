// SPDX-License-Identifier: AGPL-3.0-only

import type { CalendarContext } from "@/lib/calendar-context"
import {
  ianaLocalYmdHmToUtcMs,
  localCalendarYmdHmToUtcMs,
  parseHHMM,
  formatHHMM,
  tzLocalYmdAndOffset,
  utcMsToLocalYmd,
} from "@/lib/datetime"
import {
  isScheduleActiveOnYmd,
  parseScheduleTimesJson,
  parseScheduleFrequencyUnknown,
  dosageForScheduledTime,
} from "@/lib/schedule/schedule-recurrence"

export interface SlotEvaluatorConfig {
  leadMs: number
  slotWindowMs: number
  graceMs: number
  overdueOffsetMs: number
}

export type SlotStatus = "upcoming" | "due" | "overdue" | "overdue_push" | "inactive"

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

/** The Calendar day (Schedule clock) an instant falls on. */
export function localYmdAt(ctx: CalendarContext, ms: number): string {
  return ctx.ianaTz ? tzLocalYmdAndOffset(ms, ctx.ianaTz).ymd : utcMsToLocalYmd(ms, ctx.offsetMinutes)
}

/**
 * The creation boundary: a schedule made part-way through its start day begins at the next dose, so
 * a slot earlier that day, before the instant the schedule was created, is not an expectation. The
 * one rule every slot walker applies after `isScheduleActiveOnYmd`. It only ever concerns the start
 * day when that is also the creation day: a start date set earlier (backdated) keeps its slots, and
 * a row with no recorded creation instant has no boundary. Creation only: edits never move it.
 */
export function isSlotBeforeScheduleCreation(
  schedule: { startDate: string | null; createdAtMs: number | null },
  ctx: CalendarContext,
  ymd: string,
  slotMs: number,
): boolean {
  const createdAtMs = schedule.createdAtMs
  if (createdAtMs == null || !Number.isFinite(createdAtMs) || slotMs >= createdAtMs) return false
  const createdYmd = localYmdAt(ctx, createdAtMs)
  const startYmd = schedule.startDate?.trim() || createdYmd
  return ymd === startYmd && createdYmd === startYmd
}

/**
 * Classify a scheduled slot relative to now.
 *
 * Pure — no DB or timezone logic.
 *
 * States:
 *   upcoming     — in lead window before slot; dashboard amber, no push
 *   due          — in on-time push window [slot, slot+slotWindowMs]; dashboard red, scheduled push
 *   overdue      — in grace gap (slot+slotWindowMs, slot+overdueOffsetMs); dashboard red, no push
 *   overdue_push — in overdue push window; dashboard red, overdue push
 *   inactive     — outside all windows
 */
export function evaluateScheduledSlot(
  slotMs: number,
  nowMs: number,
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
  /** Epoch ms the schedule was created; null for a row from before the boundary existed. */
  scheduleCreatedAtMs?: number | null
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
 * epoch via `resolveSlotMs`, filtering inactive, dose-expectation (external) and dose-cleared slots. Dashboard and cron
 * both take slots from Alert readiness (`evaluateAlertReadiness`), which walks each row's own
 * local yesterday/today/tomorrow (row IANA → instance IANA → fallback) and a 3-day dose lookback.
 */
export function collectDueScheduledSlots(
  rows: readonly ScheduleAssemblyRow[],
  days: readonly string[],
  nowMs: number,
  cfg: SlotEvaluatorConfig,
  /** Slots under a dose expectation get a confirmation prompt instead of a normal alert. */
  isExternal: (personMedicationId: number, ymd: string, hhmm: string) => boolean,
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
        if (isSlotBeforeScheduleCreation({ startDate: row.scheduleStartDate, createdAtMs: row.scheduleCreatedAtMs ?? null }, row.calCtx, ymd, slotMs)) continue

        if (isExternal(row.personMedicationId, ymd, hhmm)) continue
        const status = evaluateScheduledSlot(slotMs, nowMs, cfg)
        if (status === "inactive") continue
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
