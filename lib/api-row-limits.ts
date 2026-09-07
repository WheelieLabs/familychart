// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Hard server-side cap for history/chart GETs (records, observations) so a long-lived family's
 * data can't return an unbounded result set even when the client omits `limit` or requests
 * something larger. Cursor pagination should be used by clients that need the full history.
 */
export const MAX_HISTORY_ROWS = 2000

/** Clamps a raw `limit` query param to (0, MAX_HISTORY_ROWS]; falls back to the cap when absent/invalid. */
export function clampHistoryLimit(rawLimit: string | null): number {
  const n = rawLimit != null ? parseInt(rawLimit, 10) : NaN
  if (!Number.isFinite(n) || n <= 0) return MAX_HISTORY_ROWS
  return Math.min(n, MAX_HISTORY_ROWS)
}
