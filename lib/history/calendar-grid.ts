// SPDX-License-Identifier: AGPL-3.0-only

/** Pure month-grid math for the History Calendar tab — no framework/DOM dependency. */

import { feedChipKind, type FeedChipKind, type FeedRow } from "@/lib/history/feed"
import type { SymptomEventSummary } from "@/lib/symptoms/symptom-history"
import { formatMonthYear } from "@/lib/date-format"
import { instantToZonedYmdHm } from "@/lib/datetime"

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`
}

/** yyyyMm like "2026-09". Returns the first/last calendar day of that month, inclusive. */
export function monthBounds(yyyyMm: string): { from: string; to: string } {
  const [y, m] = yyyyMm.split("-").map(Number) as [number, number]
  const lastDay = new Date(y, m, 0).getDate()
  return { from: ymd(y, m - 1, 1), to: ymd(y, m - 1, lastDay) }
}

export function shiftMonth(yyyyMm: string, deltaMonths: number): string {
  const [y, m] = yyyyMm.split("-").map(Number) as [number, number]
  const d = new Date(y, m - 1 + deltaMonths, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

export function monthLabel(yyyyMm: string): string {
  return formatMonthYear(yyyyMm)
}

/** recorded_at → YYYY-MM-DD in the household's zone, the same day the row is displayed under. */
export function feedRowLocalYmd(row: FeedRow): string {
  return instantToZonedYmdHm(row.recorded_at).date
}

/** One day's piece of a symptom's line. Caps are drawn only where the span truly starts or ends. */
export interface SymptomSegment {
  id: number
  label: string
  isStart: boolean
  isEnd: boolean
}

export interface CalendarDayCell {
  ymd: string
  inMonth: boolean
  /** One entry per non-symptom record on this day (not deduped by kind) — one dot per record. */
  kinds: FeedChipKind[]
  /** Symptom lines through this day, indexed by lane; null is an empty lane. Same length on every cell. */
  symptomLanes: (SymptomSegment | null)[]
  /** Symptoms through this day that did not fit in the capped lanes. */
  hiddenSymptoms: number
  /** Labels of every symptom through this day, for assistive text. */
  symptomLabels: string[]
}

/** Most stacked symptom lines a day cell draws; the rest are counted, not drawn. */
export const MAX_SYMPTOM_LANES = 3

function isoToLocalYmd(iso: string): string {
  const d = new Date(iso)
  return ymd(d.getFullYear(), d.getMonth(), d.getDate())
}

function localTodayYmd(): string {
  const d = new Date()
  return ymd(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * The local days a symptom covers, inclusive. The end date wins when there is one; otherwise a
 * resolved symptom ends on its resolved day and an ongoing one runs through today (never future days).
 */
export function symptomSpan(s: SymptomEventSummary, todayYmd: string): { start: string; end: string } {
  const start = isoToLocalYmd(s.start_date)
  let end: string
  if (s.end_date) end = isoToLocalYmd(s.end_date)
  else if (s.is_resolved && s.resolved_at) end = isoToLocalYmd(s.resolved_at)
  else end = todayYmd
  return { start, end: end < start ? start : end }
}

/**
 * One dot per record, each with a key that is unique within the day and stable for the same
 * records: the kind plus its running count of that kind (`medication-1`, `medication-2`, …).
 */
export function keyedKinds(kinds: readonly FeedChipKind[]): { kind: FeedChipKind; key: string }[] {
  const seen = new Map<FeedChipKind, number>()
  return kinds.map(kind => {
    const n = (seen.get(kind) ?? 0) + 1
    seen.set(kind, n)
    return { kind, key: `${kind}-${n}` }
  })
}

/** Most dots a day cell draws; a dense day shows "+N" for the rest so the row never outgrows its height. */
export const MAX_CELL_DOTS = 6

export function capDots(kinds: readonly FeedChipKind[], max = MAX_CELL_DOTS): {
  dots: { kind: FeedChipKind; key: string }[]
  more: number
} {
  const keyed = keyedKinds(kinds)
  return { dots: keyed.slice(0, max), more: Math.max(0, keyed.length - max) }
}

function symptomsOnDay(
  day: string,
  symptoms: { id: number; label: string; start: string; end: string }[],
  lanes: Map<number, number>,
  laneCount: number,
): Pick<CalendarDayCell, "symptomLanes" | "hiddenSymptoms" | "symptomLabels"> {
  const symptomLanes: (SymptomSegment | null)[] = Array.from({ length: laneCount }, () => null)
  const labels: string[] = []
  let hiddenSymptoms = 0
  for (const sy of symptoms) {
    if (day < sy.start || day > sy.end) continue
    labels.push(sy.label)
    const lane = lanes.get(sy.id)
    if (lane === undefined || lane >= laneCount) hiddenSymptoms++
    else symptomLanes[lane] = { id: sy.id, label: sy.label, isStart: day === sy.start, isEnd: day === sy.end }
  }
  return { symptomLanes, hiddenSymptoms, symptomLabels: labels }
}

/** Sunday-first grid covering the whole month plus leading/trailing days to fill full weeks. */
export function buildCalendarGrid(
  yyyyMm: string,
  rows: FeedRow[],
  todayYmd: string = localTodayYmd(),
): CalendarDayCell[] {
  const [y, m] = yyyyMm.split("-").map(Number) as [number, number]
  const firstOfMonth = new Date(y, m - 1, 1)
  const lastDay = new Date(y, m, 0).getDate()

  const kindsByYmd = new Map<string, FeedChipKind[]>()
  const symptoms: { id: number; label: string; start: string; end: string }[] = []
  for (const row of rows) {
    if (row.kind === "symptom") {
      const span = symptomSpan(row.symptom, todayYmd)
      symptoms.push({ id: row.symptom.id, label: row.symptom.label, ...span })
      continue
    }
    const key = feedRowLocalYmd(row)
    if (!kindsByYmd.has(key)) kindsByYmd.set(key, [])
    kindsByYmd.get(key)!.push(feedChipKind(row.kind))
  }

  const leading = firstOfMonth.getDay()
  const totalCells = Math.ceil((leading + lastDay) / 7) * 7

  const cells: CalendarDayCell[] = []
  const cellYmds: string[] = []
  for (let i = 0; i < totalCells; i++) {
    const cellDate = new Date(y, m - 1, i - leading + 1)
    cellYmds.push(ymd(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate()))
  }
  const gridFirst = cellYmds[0]!
  const gridLast = cellYmds[cellYmds.length - 1]!

  // Greedy lane assignment over the spans that touch the grid: earliest start first, lowest free lane.
  const laneEnds: string[] = []
  const lanes = new Map<number, number>()
  for (const sy of symptoms.filter(x => x.start <= gridLast && x.end >= gridFirst).sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id)) {
    let lane = laneEnds.findIndex(end => end < sy.start)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = sy.end
    lanes.set(sy.id, lane)
  }
  const laneCount = Math.min(MAX_SYMPTOM_LANES, laneEnds.length)

  for (let i = 0; i < totalCells; i++) {
    const key = cellYmds[i]!
    cells.push({
      ymd: key,
      inMonth: key.startsWith(yyyyMm),
      kinds: [...(kindsByYmd.get(key) ?? [])],
      ...symptomsOnDay(key, symptoms, lanes, laneCount),
    })
  }
  return cells
}
