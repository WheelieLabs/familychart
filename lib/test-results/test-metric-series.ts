// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import type { LimitQualifier } from "../domain-types"

/** One plotted reading: a numeric test result value on its Test date. */
export interface SeriesPoint {
  date: string
  value: number
  limit_qualifier: LimitQualifier | null
  reference_range: string | null
  flag: string | null
}

/** A row in the series list: one metric in one unit with two or more numeric values. */
export interface SeriesSummary {
  metric_name: string
  unit: string | null
  count: number
  latest_value: number
  latest_qualifier: LimitQualifier | null
  latest_date: string
  panel: string | null
  /** Catalogue aliases (for search, so "Hb" finds Haemoglobin). */
  aliases: string[]
  /** Catalogue order; metrics outside the catalogue sort last. */
  sort_order: number
}

/** A panel (catalogue label) with two or more qualifying series, in catalogue order. */
export interface PanelSummary {
  panel: string
  series: { metric_name: string; unit: string | null }[]
}

export interface SeriesOverview {
  series: SeriesSummary[]
  panels: PanelSummary[]
}

/** Panels open with at most this many metrics ticked. */
export const PANEL_DEFAULT_TICKED = 6

/** Stable id for a metric-and-unit series, used in the query string. Metric names never contain "|". */
export function seriesKey(metric: string, unit: string | null): string {
  return `${metric}|${unit ?? ""}`
}

export function parseSeriesKey(key: string): { metric_name: string; unit: string | null } | null {
  const i = key.lastIndexOf("|")
  if (i <= 0) return null
  const unit = key.slice(i + 1)
  return { metric_name: key.slice(0, i), unit: unit === "" ? null : unit }
}

/** The first {@link PANEL_DEFAULT_TICKED} series of a panel, as series keys. */
export function defaultTicked(panel: PanelSummary): string[] {
  return panel.series.slice(0, PANEL_DEFAULT_TICKED).map(s => seriesKey(s.metric_name, s.unit))
}

const NUM = "(\\d+(?:\\.\\d+)?)"
const PLAIN_RANGE = new RegExp(`^\\s*${NUM}\\s*[-\\u2013\\u2014]\\s*${NUM}\\s*$`)

/**
 * Reads a plain "low - high" pair ("3.5-5.0", "3.5 – 5.0"). Anything else ("< 5", "Male: 3-5",
 * "see comment") is unreadable and returns null: a band is never guessed.
 */
export function parseReferenceRange(text: string | null): { low: number; high: number } | null {
  if (!text) return null
  const m = PLAIN_RANGE.exec(text)
  if (!m) return null
  const low = Number(m[1])
  const high = Number(m[2])
  return Number.isFinite(low) && Number.isFinite(high) && low < high ? { low, high } : null
}

export interface BandSegment {
  startT: number
  endT: number
  low: number
  high: number
}

/**
 * Reference band as steps along the time axis. Each point's own range covers the stretch from
 * halfway to its neighbours (the series' ends stay at their own dates); a point whose range is
 * unreadable leaves a gap. Neighbouring points with the same range merge into one segment.
 */
export function bandSegments(points: Pick<SeriesPoint, "date" | "reference_range">[]): BandSegment[] {
  const times = points.map(p => new Date(p.date).getTime())
  const out: BandSegment[] = []
  points.forEach((p, i) => {
    const band = parseReferenceRange(p.reference_range)
    if (!band) return
    const startT = i === 0 ? times[i] : (times[i - 1] + times[i]) / 2
    const endT = i === points.length - 1 ? times[i] : (times[i] + times[i + 1]) / 2
    const last = out[out.length - 1]
    if (last && last.endT === startT && last.low === band.low && last.high === band.high) {
      last.endT = endT
    } else {
      out.push({ startT, endT, low: band.low, high: band.high })
    }
  })
  return out
}

export type RangePreset = "3m" | "6m" | "1y" | "all"
export const RANGE_PRESETS: { id: RangePreset; label: string }[] = [
  { id: "3m", label: "3 months" },
  { id: "6m", label: "6 months" },
  { id: "1y", label: "1 year" },
  { id: "all", label: "All" },
]

/** Local-calendar `from`/`to` (YYYY-MM-DD) for a quick range ending today; "all" is unbounded. */
export function presetRange(preset: RangePreset, today: Date): { from: string | null; to: string | null } {
  if (preset === "all") return { from: null, to: null }
  const months = preset === "3m" ? 3 : preset === "6m" ? 6 : 12
  const start = new Date(today.getFullYear(), today.getMonth() - months, today.getDate())
  return { from: ymd(start), to: ymd(today) }
}

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** "5.2" or "< 0.5": a limit-qualifier value is a bound, never an exact reading. */
export function formatSeriesValue(value: number, qualifier: LimitQualifier | null): string {
  const n = Math.abs(value) >= 100 ? String(Math.round(value)) : String(Math.round(value * 100) / 100)
  return qualifier ? `${qualifier} ${n}` : n
}

interface ValueRow {
  metric_name: string
  unit: string | null
  numeric_value: number
  limit_qualifier: LimitQualifier | null
  date: string
}

interface CatalogueRow {
  metric_name: string
  aliases: string
  panel: string | null
  sort_order: number
}

function parseAliases(raw: string | undefined): string[] {
  try {
    const v = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? v.filter((a): a is string => typeof a === "string") : []
  } catch {
    return []
  }
}

/**
 * The Person's chartable series: numeric values grouped by metric (case-insensitive) and unit,
 * keeping those with two or more values. Panels are looked up at read time by metric name in
 * the catalogue (inactive metrics still resolve), so values need no stored panel.
 */
export function listSeries(db: Database.Database, personId: number): SeriesOverview {
  const rows = db.prepare(
    `SELECT v.metric_name, v.unit, v.numeric_value, v.limit_qualifier, e.date
       FROM test_result_values v JOIN test_events e ON e.id = v.test_event_id
      WHERE e.person_id = ? AND v.value_type = 'numeric' AND v.numeric_value IS NOT NULL
      ORDER BY e.date, e.id, v.id`
  ).all(personId) as ValueRow[]

  const catalogue = new Map(
    (db.prepare("SELECT metric_name, aliases, panel, sort_order FROM test_metric_config").all() as CatalogueRow[])
      .map(c => [c.metric_name.toLowerCase(), c]),
  )

  const groups = new Map<string, { name: string; unit: string | null; rows: ValueRow[] }>()
  for (const r of rows) {
    const unit = r.unit && r.unit.trim() !== "" ? r.unit : null
    const key = `${r.metric_name.toLowerCase()}|${unit ?? ""}`
    const g = groups.get(key) ?? { name: catalogue.get(r.metric_name.toLowerCase())?.metric_name ?? r.metric_name, unit, rows: [] }
    g.rows.push(r)
    groups.set(key, g)
  }

  const series: SeriesSummary[] = []
  for (const g of groups.values()) {
    if (g.rows.length < 2) continue
    const latest = g.rows[g.rows.length - 1]
    const cat = catalogue.get(g.name.toLowerCase())
    series.push({
      metric_name: g.name,
      unit: g.unit,
      count: g.rows.length,
      latest_value: latest.numeric_value,
      latest_qualifier: latest.limit_qualifier,
      latest_date: latest.date,
      panel: cat?.panel ?? null,
      aliases: parseAliases(cat?.aliases),
      sort_order: cat?.sort_order ?? Number.MAX_SAFE_INTEGER,
    })
  }
  series.sort((a, b) => a.metric_name.localeCompare(b.metric_name))

  const byPanel = new Map<string, SeriesSummary[]>()
  for (const s of series) {
    if (!s.panel) continue
    byPanel.set(s.panel, [...(byPanel.get(s.panel) ?? []), s])
  }
  const panels: PanelSummary[] = [...byPanel.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([panel, list]) => ({
      panel,
      series: [...list]
        .sort((a, b) => a.sort_order - b.sort_order || a.metric_name.localeCompare(b.metric_name))
        .map(s => ({ metric_name: s.metric_name, unit: s.unit })),
    }))
    .sort((a, b) => a.panel.localeCompare(b.panel))

  return { series, panels }
}

/**
 * Numeric values of one metric and unit on the Person, oldest first. Metric-scoped and
 * deliberately not capped by the shared history row limit, so a long range is never truncated.
 * `rangeConditions`/`rangeValues` carry the already-built Test date filter on `e.date`.
 */
export function querySeriesPoints(
  db: Database.Database,
  personId: number,
  metric: string,
  unit: string | null,
  rangeConditions: string[] = [],
  rangeValues: (string | number)[] = [],
): SeriesPoint[] {
  const conditions = [
    "e.person_id = ?",
    "v.value_type = 'numeric'",
    "v.numeric_value IS NOT NULL",
    "lower(v.metric_name) = lower(?)",
    "COALESCE(NULLIF(trim(v.unit), ''), '') = ?",
    ...rangeConditions,
  ]
  const rows = db.prepare(
    `SELECT e.date, v.numeric_value, v.limit_qualifier, v.reference_range, v.flag
       FROM test_result_values v JOIN test_events e ON e.id = v.test_event_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY e.date, e.id, v.id`
  ).all(personId, metric, unit ?? "", ...rangeValues) as {
    date: string
    numeric_value: number
    limit_qualifier: LimitQualifier | null
    reference_range: string | null
    flag: string | null
  }[]
  return rows.map(r => ({
    date: r.date,
    value: r.numeric_value,
    limit_qualifier: r.limit_qualifier,
    reference_range: r.reference_range,
    flag: r.flag,
  }))
}
