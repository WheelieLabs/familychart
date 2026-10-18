// SPDX-License-Identifier: AGPL-3.0-only

const MIN = 60_000

/** Hour ticks are every this many local hours (0, 3, 6, ...). */
export const TIMELINE_TICK_HOURS = 3

/**
 * Local-time ticks within [startMs, endMs]: every {@link TIMELINE_TICK_HOURS} hours on the device's
 * wall clock. Built from local calendar days rather than fixed 3 h steps, so a DST change shifts the
 * spacing but never the labelled hours. A tick on local midnight is flagged for the date chip.
 */
export function timelineTicks(startMs: number, endMs: number): { atMs: number; midnight: boolean }[] {
  const first = new Date(startMs)
  const out = new Map<number, boolean>()
  const lastDay = new Date(endMs)
  for (let d = new Date(first.getFullYear(), first.getMonth(), first.getDate()); d <= lastDay; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    for (let h = 0; h < 24; h += TIMELINE_TICK_HOURS) {
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).getTime()
      if (t >= startMs && t <= endMs) out.set(t, h === 0)
    }
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([atMs, midnight]) => ({ atMs, midnight }))
}

/** Local midnights within [startMs, endMs]: one or two for a 30 hour window. */
export function timelineMidnights(startMs: number, endMs: number): number[] {
  return timelineTicks(startMs, endMs).filter(t => t.midnight).map(t => t.atMs)
}

/** "3 h 20 min ago", "in 40 min", "just now" — rounded to the minute. */
export function relativeTimeLabel(atMs: number, nowMs: number): string {
  const diffMin = Math.round(Math.abs(atMs - nowMs) / MIN)
  if (diffMin < 1) return "just now"
  const h = Math.floor(diffMin / 60)
  const m = diffMin % 60
  const span = h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`
  return atMs < nowMs ? `${span} ago` : `in ${span}`
}
