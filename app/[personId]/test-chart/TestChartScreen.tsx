// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { PersonHeader } from "@/components/AppHeader"
import { personTrail } from "@/lib/ui/breadcrumbs"
import TestMetricChart from "@/components/TestMetricChart"
import Banner from "@/components/ui/Banner"
import Chip, { ChipGroup } from "@/components/ui/Chip"
import { Input } from "@/components/ui/controls"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import FormField from "@/components/ui/FormField"
import ListCard, { CardList } from "@/components/ui/ListCard"
import PageContainer from "@/components/ui/PageContainer"
import Panel from "@/components/ui/Panel"
import { formatDate } from "@/lib/date-format"
import { dashboardScheduleHeaders } from "@/lib/dashboard/dashboard-client-context"
import {
  RANGE_PRESETS,
  defaultTicked,
  formatSeriesValue,
  parseSeriesKey,
  presetRange,
  seriesKey,
  type PanelSummary,
  type RangePreset,
  type SeriesOverview,
  type SeriesPoint,
  type SeriesSummary,
} from "@/lib/test-results/test-metric-series"
import { normalise } from "@/lib/test-results/test-metric-search"
import { localDateToIsoYmd } from "@/lib/datetime"

interface Range { from: string | null; to: string | null }

/** Range from the query string: a quick preset (default 1 year), or custom `from`/`to`. */
function rangeFromParams(sp: URLSearchParams): { preset: RangePreset | "custom"; range: Range } {
  const preset = sp.get("range")
  if (preset === "custom") return { preset, range: { from: sp.get("from"), to: sp.get("to") } }
  const id = RANGE_PRESETS.some(p => p.id === preset) ? (preset as RangePreset) : "1y"
  return { preset: id, range: presetRange(id, new Date()) }
}

/** Fetches every series in `keys` for the range; `points` is null until all have arrived for the current inputs. */
function useSeriesPoints(personId: number, keys: string[], range: Range) {
  const [state, setState] = useState<{ id: string; points: Record<string, SeriesPoint[]> } | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)
  const { from, to } = range
  const id = `${keys.join("\n")}|${from}|${to}`
  useEffect(() => {
    if (keys.length === 0) return
    let cancelled = false
    Promise.all(keys.map(async key => {
      const parsed = parseSeriesKey(key)
      if (!parsed) return [key, []] as const
      const qs = new URLSearchParams({ person_id: String(personId), metric: parsed.metric_name })
      if (parsed.unit) qs.set("unit", parsed.unit)
      if (from) qs.set("from", from)
      if (to) qs.set("to", to)
      const r = await fetch(`/api/test-results/series?${qs}`, { cache: "no-store", headers: dashboardScheduleHeaders() })
      if (!r.ok) throw new Error("fetch failed")
      return [key, (await r.json()) as SeriesPoint[]] as const
    }))
      .then(entries => { if (!cancelled) setState({ id, points: Object.fromEntries(entries) }) })
      .catch(() => { if (!cancelled) setFailedId(id) })
    return () => { cancelled = true }
    // `id` already encodes keys, from and to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId, id])
  return { points: state?.id === id ? state.points : null, failed: failedId === id }
}

export default function TestChartScreen({ personId, name, photoUrl, color }: {
  personId: number
  name: string
  photoUrl: string | null
  color: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [overview, setOverview] = useState<SeriesOverview | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState("")

  useEffect(() => {
    let cancelled = false
    fetch(`/api/test-results/series?person_id=${personId}`, { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error("fetch failed"); return r.json() as Promise<SeriesOverview> })
      .then(data => { if (!cancelled) setOverview(data) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [personId])

  const selectedMetric = sp.get("metric")
  const selectedPanel = sp.get("panel")
  const { preset, range } = rangeFromParams(sp)

  /** Writes query-string state: chart choices push (so back returns to the list); tweaks replace. */
  function update(changes: Record<string, string | null>, mode: "push" | "replace" = "replace") {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k)
      else next.set(k, v)
    }
    const qs = next.toString()
    const url = qs ? `${pathname}?${qs}` : pathname
    if (mode === "push") router.push(url)
    else router.replace(url)
  }

  const panel = useMemo(
    () => overview?.panels.find(p => p.panel === selectedPanel) ?? null,
    [overview, selectedPanel],
  )
  const series = useMemo(
    () => overview?.series.find(s => seriesKey(s.metric_name, s.unit) === selectedMetric) ?? null,
    [overview, selectedMetric],
  )

  /** A link to this screen with some query-string values changed, for the lists that open a chart. */
  function hrefWith(changes: Record<string, string | null>): string {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k)
      else next.set(k, v)
    }
    const qs = next.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }

  const drilledTitle = overview ? (panel ? panel.panel : series ? series.metric_name : null) : null
  const trail = personTrail(
    personId,
    name,
    ...(drilledTitle
      ? [{ label: "All values", onClick: () => update({ metric: null, panel: null, show: null }, "push") }, { label: drilledTitle }]
      : [{ label: "Test Result Chart" }]),
  )

  return (
    <PageContainer header={<PersonHeader name={name} photoUrl={photoUrl} color={color} />} trail={trail}>
      {failed && <Banner kind="error">Could not load test result values.</Banner>}
      {!failed && !overview && <p className="fc-admin-note">Loading…</p>}
      {overview && !series && !panel && (
        <SeriesList
          overview={overview}
          query={query}
          onQuery={setQuery}
          hrefForSeries={s => hrefWith({ metric: seriesKey(s.metric_name, s.unit), panel: null, show: null })}
          hrefForPanel={p => hrefWith({ panel: p.panel, metric: null, show: null })}
        />
      )}
      {overview && (series || panel) && (
        <ChartView
          personId={personId}
          series={series}
          panel={panel}
          overview={overview}
          preset={preset}
          range={range}
          ticked={sp.get("show")?.split(",").filter(Boolean) ?? null}
          onUpdate={update}
        />
      )}
    </PageContainer>
  )
}

function SeriesList({ overview, query, onQuery, hrefForSeries, hrefForPanel }: {
  overview: SeriesOverview
  query: string
  onQuery: (q: string) => void
  hrefForSeries: (s: SeriesSummary) => string
  hrefForPanel: (p: PanelSummary) => string
}) {
  const q = normalise(query)
  const series = overview.series.filter(s => !q || normalise(s.metric_name).includes(q) || s.aliases.some(a => normalise(a).includes(q)) || (s.panel && normalise(s.panel).includes(q)))
  const panels = overview.panels.filter(p => !q || normalise(p.panel).includes(q))

  if (overview.series.length === 0) {
    return (
      <EmptyState icon={EMPTY_STATE_ICONS.noTestResults} heading="Nothing to chart yet">
        A value appears here once it has been recorded at least twice with a number.
      </EmptyState>
    )
  }

  return (
    <>
      <Panel>
        <FormField label="Search test result values" hint="Search by name, alias or panel, e.g. Hb or Ferritin.">
          <Input type="search" value={query} onChange={e => onQuery(e.target.value)} />
        </FormField>
      </Panel>
      {panels.length > 0 && (
        <section aria-labelledby="chart-panels" className="fc-history">
          <h2 id="chart-panels" className="fc-block-heading">Panels</h2>
          <CardList>
            {panels.map(p => (
              <ListCard key={p.panel} icon="🧪" title={p.panel} href={hrefForPanel(p)} meta={[`${p.series.length} values charted together`]} />
            ))}
          </CardList>
        </section>
      )}
      <section aria-labelledby="chart-series" className="fc-history">
        <h2 id="chart-series" className="fc-block-heading">Values</h2>
        {series.length === 0 && <p className="fc-history__count">No values match “{query}”.</p>}
        <CardList>
          {series.map(s => (
            <ListCard
              key={seriesKey(s.metric_name, s.unit)}
              icon="📈"
              title={s.unit ? `${s.metric_name} · ${s.unit}` : s.metric_name}
              href={hrefForSeries(s)}
              meta={[
                `${s.count} values`,
                `Latest ${formatSeriesValue(s.latest_value, s.latest_qualifier)}${s.unit ? ` ${s.unit}` : ""} · ${formatDate(s.latest_date)}`,
              ]}
            />
          ))}
        </CardList>
      </section>
    </>
  )
}

function ChartView({ personId, series, panel, overview, preset, range, ticked, onUpdate }: {
  personId: number
  series: SeriesSummary | null
  panel: PanelSummary | null
  overview: SeriesOverview
  preset: RangePreset | "custom"
  range: Range
  ticked: string[] | null
  onUpdate: (changes: Record<string, string | null>) => void
}) {
  const panelKeys = panel ? panel.series.map(s => seriesKey(s.metric_name, s.unit)) : []
  const shown = panel ? (ticked ?? defaultTicked(panel)).filter(k => panelKeys.includes(k)) : []
  const keys = panel ? shown : series ? [seriesKey(series.metric_name, series.unit)] : []

  function toggle(key: string) {
    const next = panelKeys.filter(k => (k === key ? !shown.includes(key) : shown.includes(k)))
    onUpdate({ show: next.join(",") || "-" })
  }

  const title = panel ? panel.panel : series!.metric_name
  return (
    <>
      <h2 className="fc-section-title fc-surface-title">{title}</h2>

      <ChipGroup
        legend="Date range"
        value={preset}
        options={[...RANGE_PRESETS.map(p => ({ value: p.id as RangePreset | "custom", label: p.label })), { value: "custom" as const, label: "Custom" }]}
        onChange={value => {
          if (value === "custom") {
            onUpdate({ range: "custom", from: range.from ?? presetRange("1y", new Date()).from, to: range.to ?? localDateToIsoYmd(new Date()) })
          } else {
            onUpdate({ range: value, from: null, to: null })
          }
        }}
      />
      {preset === "custom" && (
        <Panel>
          <div className="fc-form-pair">
            <FormField label="From">
              <Input type="date" value={range.from ?? ""} max={range.to ?? undefined}
                onChange={e => onUpdate({ from: e.target.value || null })} />
            </FormField>
            <FormField label="To">
              <Input type="date" value={range.to ?? ""} min={range.from ?? undefined}
                onChange={e => onUpdate({ to: e.target.value || null })} />
            </FormField>
          </div>
        </Panel>
      )}

      {panel && (
        <fieldset className="fc-chip-set">
          <legend className="fc-chip-set__legend">Values to show</legend>
          <div className="fc-chip-set__chips">
            {panel.series.map(s => {
              const key = seriesKey(s.metric_name, s.unit)
              return (
                <Chip key={key} kind="toggle" pressed={shown.includes(key)} onPressedChange={() => toggle(key)}>
                  {s.metric_name}
                </Chip>
              )
            })}
          </div>
        </fieldset>
      )}

      <ChartStack personId={personId} keys={keys} overview={overview} range={range} stacked={panel !== null} />
    </>
  )
}

/** Fetches every shown series and draws them on one shared date axis (a single chart is a stack of one). */
function ChartStack({ personId, keys, overview, range, stacked }: {
  personId: number
  keys: string[]
  overview: SeriesOverview
  range: Range
  stacked: boolean
}) {
  const { points, failed } = useSeriesPoints(personId, keys, range)
  if (keys.length === 0) return <p className="fc-history__count">Choose at least one value to chart.</p>
  if (failed) return <Banner kind="error">Could not load the chart.</Banner>
  if (!points) return <p className="fc-admin-note">Loading…</p>

  const fetched = keys.map(key => ({ key, points: points[key] ?? [] }))
  const allTimes = fetched.flatMap(f => f.points.map(p => new Date(p.date).getTime()))
  const domain = allTimes.length ? { minT: Math.min(...allTimes), maxT: Math.max(...allTimes) } : undefined
  return (
    <div className="fc-history">
      {fetched.map((f, i) => {
        const parsed = parseSeriesKey(f.key)!
        const known = overview.series.find(s => seriesKey(s.metric_name, s.unit) === f.key)
        return (
          <TestMetricChart
            key={f.key}
            label={known?.metric_name ?? parsed.metric_name}
            unit={parsed.unit}
            points={f.points}
            domain={stacked ? domain : undefined}
            showDates={!stacked || i === fetched.length - 1}
            tableOpen={!stacked}
          />
        )
      })}
    </div>
  )
}
