// SPDX-License-Identifier: AGPL-3.0-only

import { instantToZonedYmdHm } from "@/lib/datetime"

const DAY_MS = 86_400_000

/**
 * The calendar date (YYYY-MM-DD) of a stored symptom date. A symptom is recorded for a day and
 * stored as that day's local midnight, so converting it back needs the zone it was recorded in:
 * the instance timezone when one is configured, otherwise the nearest UTC midnight, which is right
 * for every zone within 12 hours of UTC (local midnight is then under 12 hours from a UTC midnight).
 */
export function symptomStoredDateToYmd(iso: string | null, ianaTz: string | null): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  if (ianaTz) {
    try {
      return instantToZonedYmdHm(ms, ianaTz).date
    } catch {
      /* fall through to the zone-free rule */
    }
  }
  return new Date(Math.round(ms / DAY_MS) * DAY_MS).toISOString().slice(0, 10)
}
