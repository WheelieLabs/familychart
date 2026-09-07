// SPDX-License-Identifier: AGPL-3.0-only

import type { HydrationPacingStatus, PacingState } from "@/lib/hydration/hydration-pacing"

export const HYDRATION_NUDGE_CADENCE_NORMAL_MIN = 60
export const HYDRATION_NUDGE_CADENCE_ESCALATED_MIN = 30
export const HYDRATION_NUDGE_ESCALATION_MULTIPLIER = 1.5

export interface HydrationNudgeDecisionInput {
  /** Self-recording user linked to this person. */
  isUser: boolean
  pacingStatus: HydrationPacingStatus
  activeStartMin: number
  activeEndMin: number
  nowLocalMinutes: number
  glassesNeededNow: number | null
  requiredRate: number | null | undefined
  targetMl: number
  lastNudgeAtMs: number | null
  lastRecordAtMs?: number | null
  nowMs: number
}

export interface HydrationNudgeDecision {
  eligible: boolean
  cadenceMinutes: number
  escalated: boolean
  reason?: string
}

/** Even-pace baseline: target mL spread evenly across the active window (mL/hr). */
export function computeEvenPaceBaselineMlPerHour(
  targetMl: number,
  activeStartMin: number,
  activeEndMin: number,
): number {
  const totalActiveHours = (activeEndMin - activeStartMin) / 60
  if (totalActiveHours <= 0) return 0
  return targetMl / totalActiveHours
}

export function isHydrationNudgeEscalated(
  requiredRate: number | null | undefined,
  baselineMlPerHr: number,
  multiplier: number = HYDRATION_NUDGE_ESCALATION_MULTIPLIER,
): boolean {
  if (requiredRate == null || baselineMlPerHr <= 0) return false
  return requiredRate > baselineMlPerHr * multiplier
}

export function hydrationNudgeCadenceMinutes(escalated: boolean): number {
  return escalated ? HYDRATION_NUDGE_CADENCE_ESCALATED_MIN : HYDRATION_NUDGE_CADENCE_NORMAL_MIN
}

function minutesSince(fromMs: number | null, nowMs: number): number {
  if (fromMs == null) return Infinity
  return (nowMs - fromMs) / 60_000
}

function isInsideActiveWindow(
  nowLocalMinutes: number,
  activeStartMin: number,
  activeEndMin: number,
): boolean {
  return nowLocalMinutes >= activeStartMin && nowLocalMinutes < activeEndMin
}

/** Pure eligibility + cadence gate for hydration push nudges (no DB, no cron). */
export function evaluateHydrationNudge(input: HydrationNudgeDecisionInput): HydrationNudgeDecision {
  const baseline = computeEvenPaceBaselineMlPerHour(
    input.targetMl,
    input.activeStartMin,
    input.activeEndMin,
  )
  const escalated = isHydrationNudgeEscalated(input.requiredRate, baseline)
  const cadenceMinutes = hydrationNudgeCadenceMinutes(escalated)

  if (!input.isUser) {
    return { eligible: false, cadenceMinutes, escalated, reason: "non_user" }
  }
  if (input.pacingStatus !== "behind") {
    return { eligible: false, cadenceMinutes, escalated, reason: `status_${input.pacingStatus}` }
  }
  if (!isInsideActiveWindow(input.nowLocalMinutes, input.activeStartMin, input.activeEndMin)) {
    return { eligible: false, cadenceMinutes, escalated, reason: "outside_active_window" }
  }
  if (input.glassesNeededNow == null || input.glassesNeededNow <= 0) {
    return { eligible: false, cadenceMinutes, escalated, reason: "no_glasses_actionable" }
  }
  const cadenceAnchorMs = Math.max(input.lastNudgeAtMs ?? 0, input.lastRecordAtMs ?? 0)
  const cadenceAnchor = cadenceAnchorMs > 0 ? cadenceAnchorMs : null
  if (minutesSince(cadenceAnchor, input.nowMs) < cadenceMinutes) {
    return { eligible: false, cadenceMinutes, escalated, reason: "cadence_gate" }
  }

  return { eligible: true, cadenceMinutes, escalated }
}

/** Convenience wrapper when a full PacingState is already computed. */
export function evaluateHydrationNudgeFromPacing(
  input: Omit<HydrationNudgeDecisionInput, "pacingStatus" | "glassesNeededNow" | "requiredRate"> & {
    pacing: PacingState
  },
): HydrationNudgeDecision {
  return evaluateHydrationNudge({
    ...input,
    pacingStatus: input.pacing.status,
    glassesNeededNow: input.pacing.glassesNeededNow,
    requiredRate: input.pacing.requiredRate,
  })
}
