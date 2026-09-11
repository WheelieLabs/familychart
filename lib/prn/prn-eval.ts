// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure PRN dose-state evaluation — safe for client and server.
 * Server loaders live in `lib/medication-dose-state.ts`; UI status panels
 * must use `evaluatePrnState` so alerts match the dashboard (see ADR-0011).
 */

import type { FrequencyRule } from "@/lib/domain-types"
import { ruleMax24hIsDoseCount } from "@/lib/frequency-rule"

/** Per-(person, medication) slice for evaluation. */
export interface MedicationDoseSlice {
  rule: FrequencyRule | null
  total24h: number
  lastDose: { lastIso: string; remindAfterHours: number | null; lastMedName: string | null } | null
  oldest24h: string | null
  /** Last recorded dosage from dose history; fallback when rule and catalogue dosage are both null. */
  lastDosage: number | null
  /** Default dosage from the medication catalogue. */
  catalogDefaultDosage: number | null
}

/**
 * PRN evaluation result: alert flags plus timing instants.
 *
 * Timing fields are always computed when inputs exist (`null` only when missing).
 * Callers must format `resetAtMs` / `availableAtMs` for display **only when the
 * matching flag is true** (`atCap`|`coverageGap` / `cooldown`). Times are raw
 * facts; flags are the alert signal (e.g. `max_hours_between` can clear cooldown
 * while `availableAtMs` is still in the future).
 */
export interface PrnEvalResult {
  atCap: boolean
  coverageGap: boolean
  cooldown: boolean
  canDose: boolean
  /** 24h rolling window clear time (`oldest24h + 24h`), or null if no oldest dose. */
  resetAtMs: number | null
  /** Next-available after last dose + effective offset, or null if no interval context. */
  availableAtMs: number | null
  /** `remindAfterHours ?? min_hours_between`, or null when N/A. */
  effectiveOffsetH: number | null
}

const EMPTY_TIMING = {
  resetAtMs: null as number | null,
  availableAtMs: null as number | null,
  effectiveOffsetH: null as number | null,
}

/**
 * Evaluates PRN dosing state from a pre-loaded slice.
 * Returns flags and timing — callers map these to issues, pushes, or UI indicators.
 *
 * atCap:       person has reached the 24h maximum
 * coverageGap: one dose away from 24h cap (warn before the window runs out)
 * cooldown:    minimum interval since last dose has not elapsed
 * canDose:     !atCap && !cooldown — **alert-state convenience flag only**.
 *              Does NOT mean "allowed to write". Dose APIs intentionally never
 *              gate on these flags (see ADR-0011); FamilyChart records history.
 *              Cron PRN readiness is `!cooldown` (still skip when `atCap`).
 */
export function evaluatePrnState(slice: MedicationDoseSlice, now: Date): PrnEvalResult {
  const { rule, total24h, lastDose, oldest24h, lastDosage, catalogDefaultDosage } = slice
  const nowMs = now.getTime()

  if (!rule) {
    return { atCap: false, coverageGap: false, cooldown: false, canDose: true, ...EMPTY_TIMING }
  }

  const minH = rule.min_hours_between
  const resetAtMs = oldest24h ? new Date(oldest24h).getTime() + 24 * 3_600_000 : null

  let availableAtMs: number | null = null
  let effectiveOffsetH: number | null = null
  if (Number.isFinite(minH) && minH > 0 && lastDose != null) {
    effectiveOffsetH = lastDose.remindAfterHours ?? minH
    availableAtMs = new Date(lastDose.lastIso).getTime() + effectiveOffsetH * 3_600_000
  }

  let atCap = false
  let coverageGap = false

  if (rule.max_quantity_per_24h != null) {
    const max = rule.max_quantity_per_24h
    const lastDoseMs = lastDose ? new Date(lastDose.lastIso).getTime() : null
    const earliestNextMs =
      minH > 0 && lastDoseMs != null ? Math.max(nowMs, lastDoseMs + minH * 3_600_000) : nowMs
    const gapIsMoot =
      resetAtMs != null && minH > 0 && earliestNextMs + minH * 3_600_000 >= resetAtMs

    if (ruleMax24hIsDoseCount(rule)) {
      atCap = total24h >= max
      coverageGap = !atCap && !gapIsMoot && total24h >= 1 && total24h === max - 1
    } else {
      const oneDoseUnit = rule.dosage ?? catalogDefaultDosage ?? lastDosage ?? null
      if (oneDoseUnit == null) {
        atCap = total24h >= max
      } else {
        const remaining = max - total24h
        atCap = remaining < oneDoseUnit
        coverageGap = !atCap && !gapIsMoot && total24h > 0 && remaining < 2 * oneDoseUnit
      }
    }
  }

  let cooldown = false
  if (effectiveOffsetH != null && availableAtMs != null && lastDose != null) {
    const lastMs = new Date(lastDose.lastIso).getTime()
    const maxH = rule.max_hours_between
    const hoursSince = (nowMs - lastMs) / 3_600_000
    const stillRelevant = maxH != null ? hoursSince < maxH : hoursSince < effectiveOffsetH
    cooldown = stillRelevant && nowMs < availableAtMs
  }

  return {
    atCap,
    coverageGap,
    cooldown,
    canDose: !atCap && !cooldown,
    resetAtMs,
    availableAtMs,
    effectiveOffsetH,
  }
}
