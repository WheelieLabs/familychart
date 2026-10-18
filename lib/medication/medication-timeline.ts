// SPDX-License-Identifier: AGPL-3.0-only

import { medicationFlag, type FeedFlag } from "@/lib/history/feed"
import type { DoseTiming } from "@/lib/medication/dose-timing-display"
import type { PrnEvalResult } from "@/lib/prn/prn-eval"

/** Trailing window and single lookahead shown on the per-person medication timeline. */
export const TIMELINE_WINDOW_HOURS = 24
export const TIMELINE_LOOKAHEAD_HOURS = 6

const H = 3_600_000

export type TimelineMarker =
  /**
   * A recorded dose; links to its Live Feed row. `timing` is On time, Late or Early against its slot,
   * or null when it attached to none (an extra dose, an unscheduled medication, or one given away from home).
   */
  | { kind: "taken"; atIso: string; recordId: number; feedRowId: string; flag: FeedFlag | null; timing: DoseTiming["result"] | null }
  /** A scheduled slot still open: not yet due, or past its due window with no dose. */
  | { kind: "upcoming" | "overdue"; atIso: string; flag: null }
  /** A scheduled slot that ended with no dose recorded. */
  | { kind: "missed"; atIso: string; flag: null }
  /** The next single instant a PRN dose becomes eligible (as-needed lanes only). */
  | { kind: "next_eligible"; atIso: string; flag: null }

export interface TimelineBand {
  startIso: string
  endIso: string
}

export interface MedicationTimelineLane {
  medicationId: number
  name: string
  kind: "prn" | "scheduled"
  markers: TimelineMarker[]
  /** Every scheduled slot time in the window and lookahead, drawn as a dotted line so a dose's distance from its slot shows. */
  slotLines: string[]
  cooldown: TimelineBand | null
  capWindow: TimelineBand | null
  atCap: boolean
  coverageGap: boolean
}

export interface TimelineDose {
  id: number
  recorded_at: string
  /** The timing stored against the dose's slot; null when it attached to none. */
  timing: DoseTiming | null
}

export interface TimelineSlot {
  atMs: number
  /** `resolved`: a dose attached to it. `missed`: it ended with no dose. */
  status: "upcoming" | "due" | "overdue" | "resolved" | "missed"
}

const iso = (ms: number): string => new Date(ms).toISOString()

/** True when a record falls inside the timeline's trailing window (drives "View on timeline"). */
export function isWithinTimelineWindow(recordedAtIso: string, nowMs: number): boolean {
  const t = new Date(recordedAtIso).getTime()
  return Number.isFinite(t) && t >= nowMs - TIMELINE_WINDOW_HOURS * H && t <= nowMs
}

/**
 * Builds one medication's lane, or null when it doesn't qualify (no dose in the trailing window
 * and nothing upcoming or possible). Taken and overdue markers take their flag from the Live
 * Feed's `medicationFlag`, so the two surfaces can't disagree; forward-looking markers stay
 * outside that model.
 */
export function buildMedicationTimelineLane(input: {
  medicationId: number
  name: string
  doses: readonly TimelineDose[]
  /** The shared 24h-cap/cooldown decision (null only when none was evaluated). */
  prn: PrnEvalResult | null
  /** Alert readiness' "scheduled" for this medication. Scheduled lanes show slots, so no next-eligible marker. */
  scheduled: boolean
  slots: readonly TimelineSlot[]
  nowMs: number
}): MedicationTimelineLane | null {
  const { nowMs, prn } = input
  const windowStart = nowMs - TIMELINE_WINDOW_HOURS * H
  const windowEnd = nowMs + TIMELINE_LOOKAHEAD_HOURS * H

  const doses = input.doses
    .filter((d) => {
      const t = new Date(d.recorded_at).getTime()
      return t >= windowStart && t <= nowMs
    })
    .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())

  const markers: TimelineMarker[] = doses.map((d) => ({
    kind: "taken",
    atIso: d.recorded_at,
    recordId: d.id,
    feedRowId: `med:${d.id}`,
    flag: medicationFlag({ timing: d.timing }),
    timing: d.timing?.result ?? null,
  }))

  for (const slot of input.slots) {
    if (slot.atMs < windowStart || slot.atMs > windowEnd) continue
    if (slot.status === "upcoming" || slot.status === "due") {
      markers.push({ kind: "upcoming", atIso: iso(slot.atMs), flag: null })
    } else if (slot.status === "overdue") {
      markers.push({ kind: "overdue", atIso: iso(slot.atMs), flag: null })
    } else if (slot.status === "missed") {
      markers.push({ kind: "missed", atIso: iso(slot.atMs), flag: null })
    }
  }

  let cooldown: TimelineBand | null = null
  let capWindow: TimelineBand | null = null
  if (prn) {
    if (prn.cooldown && prn.availableAtMs != null && doses.length > 0) {
      cooldown = { startIso: doses[doses.length - 1].recorded_at, endIso: iso(prn.availableAtMs) }
    }
    if ((prn.atCap || prn.coverageGap) && prn.resetAtMs != null && doses.length > 0) {
      capWindow = { startIso: doses[0].recorded_at, endIso: iso(prn.resetAtMs) }
    }
    if (
      prn.availableAtMs != null
      && prn.availableAtMs > nowMs
      && prn.availableAtMs <= windowEnd
      && !prn.atCap
      && !input.scheduled
    ) {
      markers.push({ kind: "next_eligible", atIso: iso(prn.availableAtMs), flag: null })
    }
  }

  if (markers.length === 0) return null

  markers.sort((a, b) => new Date(a.atIso).getTime() - new Date(b.atIso).getTime())

  return {
    medicationId: input.medicationId,
    name: input.name,
    kind: input.scheduled ? "scheduled" : "prn",
    markers,
    slotLines: input.slots
      .filter((slot) => slot.atMs >= windowStart && slot.atMs <= windowEnd)
      .map((slot) => slot.atMs)
      .sort((a, b) => a - b)
      .map(iso),
    cooldown,
    capWindow,
    atCap: prn?.atCap ?? false,
    coverageGap: prn?.coverageGap ?? false,
  }
}
