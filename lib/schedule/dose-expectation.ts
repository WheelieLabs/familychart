// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Dose expectations: a parent-defined "this scheduled dose is routinely given away from home"
 * (e.g. a midday dose at school during term). Pure applicability and pending logic — no DB, no
 * HTTP. A slot is addressed as `(personMedicationId, slotHhmm)`. Pending is derived, never
 * stored: only outcomes are.
 */

import { weekdayJsSun0FromIsoYmd } from "@/lib/schedule/schedule-recurrence"
import { isSlotClearedByDose, type SlotEvaluatorConfig } from "@/lib/schedule/schedule-slot-evaluator"

export interface DoseExpectation {
  id: number
  personMedicationId: number
  slotHhmm: string
  /** Inclusive local-calendar term range, parent-entered (never pulled from an external calendar). */
  startDate: string
  endDate: string
  /** JS weekdays (0 = Sunday) the expectation applies on; null or empty = every day in range. */
  weekdays: number[] | null
}

export type ExpectationOutcomeStatus = "confirmed_given" | "confirmed_missed" | "snoozed"

export interface ExpectationOutcome {
  expectationId: number
  localYmd: string
  status: ExpectationOutcomeStatus
  /** Only meaningful for `snoozed`. */
  snoozedUntilMs: number | null
}

export interface PendingExpectation {
  expectationId: number
  personMedicationId: number
  ymd: string
  hhmm: string
  slotMs: number
}

export function expectationAppliesOnYmd(
  expectation: DoseExpectation,
  exceptionYmds: ReadonlySet<string>,
  ymd: string,
): boolean {
  if (ymd < expectation.startDate || ymd > expectation.endDate) return false
  if (exceptionYmds.has(ymd)) return false
  const weekdays = expectation.weekdays
  if (weekdays && weekdays.length > 0 && !weekdays.includes(weekdayJsSun0FromIsoYmd(ymd))) return false
  return true
}

/** True when this scheduled slot is expected to be given away from home on `ymd`. */
export function isSlotExternal(
  expectations: readonly DoseExpectation[],
  exceptionsByExpectation: ReadonlyMap<number, ReadonlySet<string>>,
  personMedicationId: number,
  hhmm: string,
  ymd: string,
): boolean {
  return expectations.some(
    e =>
      e.personMedicationId === personMedicationId
      && e.slotHhmm === hhmm
      && expectationAppliesOnYmd(e, exceptionsByExpectation.get(e.id) ?? new Set(), ymd),
  )
}

/** A confirmation push goes out only while the slot is this recent, so a restart or outage never pushes about a dose from hours ago. */
export const PUSH_FRESH_WINDOW_MS = 3 * 60 * 60_000

export function isFreshForPush(slotMs: number, nowMs: number): boolean {
  return nowMs - slotMs <= PUSH_FRESH_WINDOW_MS
}

/**
 * Expectations awaiting confirmation: applicable today, slot time passed, no confirmed outcome,
 * not snoozed, and no dose already logged near the slot. A pending prompt lasts to the end of its
 * local day.
 */
export function derivePendingExpectations(input: {
  expectations: readonly DoseExpectation[]
  exceptionsByExpectation: ReadonlyMap<number, ReadonlySet<string>>
  outcomes: readonly ExpectationOutcome[]
  /** Recorded dose instants (epoch ms) for the expectation's person + medication. */
  doseMsFor: (expectation: DoseExpectation) => readonly number[]
  /** The expectation's local "today" and the slot instant on it; null when no calendar context. */
  resolve: (expectation: DoseExpectation) => { ymd: string; slotMs: number } | null
  nowMs: number
  cfg: SlotEvaluatorConfig
}): PendingExpectation[] {
  const out: PendingExpectation[] = []
  for (const e of input.expectations) {
    const ctx = input.resolve(e)
    if (!ctx) continue
    if (!expectationAppliesOnYmd(e, input.exceptionsByExpectation.get(e.id) ?? new Set(), ctx.ymd)) continue
    if (ctx.slotMs > input.nowMs) continue

    const outcome = input.outcomes.find(o => o.expectationId === e.id && o.localYmd === ctx.ymd)
    if (outcome) {
      if (outcome.status !== "snoozed") continue
      if (outcome.snoozedUntilMs != null && outcome.snoozedUntilMs > input.nowMs) continue
    }

    if (isSlotClearedByDose(input.doseMsFor(e), ctx.slotMs, input.cfg)) continue

    out.push({
      expectationId: e.id,
      personMedicationId: e.personMedicationId,
      ymd: ctx.ymd,
      hhmm: e.slotHhmm,
      slotMs: ctx.slotMs,
    })
  }
  return out
}
