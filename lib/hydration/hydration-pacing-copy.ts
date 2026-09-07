// SPDX-License-Identifier: AGPL-3.0-only

import { formatHydration } from "@/lib/format"
import { formatCount } from "@/lib/format-count"
import type { PacingState } from "@/lib/hydration/hydration-pacing"

/** User-facing hydration pacing hint for dashboard surfaces. Returns null when no warning. */
export function hydrationPacingHint(pacing: PacingState): string | null {
  switch (pacing.status) {
    case "behind":
      if (pacing.catchUpRealistic && pacing.glassesNeededNow != null) {
        return `≈${formatCount(pacing.glassesNeededNow, "glass", "glasses")} to catch up`
      }
      return `Unlikely to reach goal today — ${formatHydration(pacing.deficit)} short`
    case "window_closed": {
      const remainingVolume = Math.max(0, pacing.target - pacing.consumed)
      return `Ended ${formatHydration(remainingVolume)} short of goal.`
    }
    default:
      return null
  }
}

/** Alert copy for the dashboard API when hydration pacing warrants attention. */
export function hydrationPacingAlertCopy(
  pacing: PacingState
): { description: string; short: string; sub: string } | null {
  const hint = hydrationPacingHint(pacing)
  if (!hint) return null
  return {
    description: `Hydration — ${hint}`,
    short: `Hydration · ${hint}`,
    sub: hint,
  }
}
