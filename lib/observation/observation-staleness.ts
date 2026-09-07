// SPDX-License-Identifier: AGPL-3.0-only

/** Hours since an ISO datetime (fractional). */
export function hoursSinceRecorded(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60)
}

/** True when `lastRecordedIso` is at least `staleAfterHours` old; false if threshold is absent or invalid. */
export function isStaleReading(
  lastRecordedIso: string,
  staleAfterHours: number | null | undefined,
): boolean {
  if (staleAfterHours == null || staleAfterHours <= 0) return false
  return hoursSinceRecorded(lastRecordedIso) >= staleAfterHours
}

/** Short phrase for UI (e.g. "3 days", "12 hours") from a positive hour count. */
export function formatStaleThresholdHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return ""
  const days = hours / 24
  if (days >= 1 && Math.abs(days - Math.round(days)) < 0.001) {
    const d = Math.round(days)
    if (d === 7) return "1 week"
    if (d === 1) return "1 day"
    return `${d} days`
  }
  if (hours < 24) {
    const r = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10
    return `${r} hour${r === 1 ? "" : "s"}`
  }
  return `${Math.round(hours)} hours`
}
