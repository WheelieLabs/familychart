// SPDX-License-Identifier: AGPL-3.0-only

/** Upper bound when a frequency rule has no max_hours_between. */
export const PRN_REMIND_DEFAULT_MAX_HOURS = 168

export type PrnRemindHoursResult =
  | { ok: true; hours: number | null }
  | { ok: false; error: string }

/**
 * Validates and clamps client-supplied remind_after_hours against the medication rule.
 * Returns null hours when the client omits the field (eval uses min_hours_between).
 */
export function resolvePrnRemindAfterHours(
  requested: unknown,
  minHoursBetween: number,
  maxHoursBetween: number | null,
): PrnRemindHoursResult {
  if (requested == null || requested === "") {
    return { ok: true, hours: null }
  }

  if (typeof requested !== "number" || !isFinite(requested) || requested <= 0) {
    return { ok: false, error: "remind_after_hours must be a positive number" }
  }

  if (minHoursBetween > 0 && requested < minHoursBetween) {
    return {
      ok: false,
      error: `remind_after_hours cannot be below the minimum interval (${minHoursBetween} hours)`,
    }
  }

  const upper =
    maxHoursBetween != null && maxHoursBetween >= minHoursBetween
      ? maxHoursBetween
      : Math.max(minHoursBetween, PRN_REMIND_DEFAULT_MAX_HOURS)

  return { ok: true, hours: Math.min(requested, upper) }
}
