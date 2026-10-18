// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Which goal types each observation type may have. Shared by the Goals tab, the goals API and
 * the History chart so they agree. A type that is not listed has no goals: Height and Head
 * Circumference are judged against age- and sex-specific growth centiles, so a fixed range
 * would mislead. Saved rows for those types are left in the database (export and restore
 * carry them) but are neither listed nor drawn.
 */
export type GoalType = "range" | "daily_min" | "trend"

const GOAL_TYPES_BY_OBSERVATION: Readonly<Record<string, readonly GoalType[]>> = {
  Hydration: ["daily_min"],
  Weight: ["range", "trend"],
  Temperature: ["range"],
  "Blood Pressure": ["range"],
  "Heart Rate": ["range"],
  SpO2: ["range"],
  "Blood Glucose": ["range"],
  Respirations: ["range"],
}

export function goalTypesFor(observationType: string): readonly GoalType[] {
  return GOAL_TYPES_BY_OBSERVATION[observationType] ?? []
}

export function isGoalEligible(observationType: string, goalType?: string): boolean {
  const types = goalTypesFor(observationType)
  return goalType === undefined ? types.length > 0 : (types as readonly string[]).includes(goalType)
}
