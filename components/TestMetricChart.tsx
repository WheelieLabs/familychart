// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useId, useRef, useState } from "react"
import { formatDate, formatDateShort } from "@/lib/date-format"
import { CHART_SVG_FONT_MD, CHART_SVG_FONT_SM } from "@/lib/chart-svg-typography"
import { bandSegments, formatSeriesValue, type SeriesPoint } from "@/lib/test-results/test-metric-series"

interface Props {
  label: string
  unit: string | null
  points: SeriesPoint[]
  /** Shared time axis (ms) so stacked charts line up; defaults to this series' own extent. */
  domain?: { minT: number; maxT: number }
  /** Stacked charts show date labels on the last chart only. */
  showDates?: boolean
  /** The data table starts open for a single chart (like the observation history) and closed in a panel. */
  tableOpen?: boolean
}

const W = 800
const pTop = 14
const pRight = 24
const pLeft = 62

const dateFmt = (iso: string | number, withYear: boolean) =>
  withYear ? formatDate(iso) : formatDateShort(iso, { now: iso })

function fmtAxis(v: number): string {
  return String(Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10)
}

/**
 * Line chart of one test metric over time: the report's own reference range as a stepped band,
 * limit-qualifier values as hollow bound markers, flagged values ringed, and a collapsible data table.
 */
export default function TestMetricChart({ label, unit, points, domain, showDates = true, tableOpen = false }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const tableId = useId()
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null)

  const H = showDates ? 220 : 170
  const pBottom = showDates ? 34 : 12
  const plotW = W - pLeft - pRight
  const plotH = H - pTop - pBottom

  if (points.length === 0) {
    return <p className="text-text-on-brand-muted text-sm py-3">{label}: no values in this range.</p>
  }

  const times = points.map(p => new Date(p.date).getTime())
  const minT = domain?.minT ?? Math.min(...times)
  const maxT = domain?.maxT ?? Math.max(...times)
  const values = points.map(p => p.value)
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = hi === lo ? 1 : (hi - lo) * 0.15
  const yMin = lo - pad
  const yMax = hi + pad
  const xS = (t: number) => (maxT === minT ? pLeft + plotW / 2 : pLeft + ((t - minT) / (maxT - minT)) * plotW)
  const yS = (v: number) => pTop + plotH - ((v - yMin) / (yMax - yMin)) * plotH
  const clampY = (y: number) => Math.min(pTop + plotH, Math.max(pTop, y))

  const bands = bandSegments(points)
  const withYear = maxT - minT > 60 * 86400000
  const grid = [0, 1, 2].map(i => yMin + ((yMax - yMin) * i) / 2)
  const labelCount = showDates ? Math.min(5, Math.max(2, points.length)) : 0
  const xLabels = Array.from({ length: labelCount }, (_, i) => minT + ((maxT - minT) * i) / Math.max(1, labelCount - 1))

  const unitText = unit ? ` ${unit}` : ""
  const describe = (p: SeriesPoint) => [
    label,
    `${formatSeriesValue(p.value, p.limit_qualifier)}${unitText}${p.limit_qualifier ? " (limit, not an exact reading)" : ""}`,
    dateFmt(p.date, true),
    ...(p.reference_range ? [`Range ${p.reference_range}`] : []),
    ...(p.flag ? [`Flag: ${p.flag}`] : []),
  ]

  function showAt(el: Element, p: SeriesPoint) {
    const wrap = wrapRef.current
    if (!wrap) return
    const b = el.getBoundingClientRect()
    const w = wrap.getBoundingClientRect()
    setTip({ x: b.left - w.left + b.width / 2, y: b.top - w.top, lines: describe(p) })
  }

  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h3 className="text-white font-semibold text-sm">{label}</h3>
        {unit && <span className="text-text-on-brand-muted text-xs">{unit}</span>}
      </div>
      <div ref={wrapRef} className="relative">
        {tip && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 max-w-[240px] rounded-md border border-white/25 bg-gray-950/95 px-2.5 py-1.5 text-left text-xs text-white shadow-lg"
            style={{ left: tip.x, top: tip.y, transform: "translate(-50%, calc(-100% - 8px))" }}
          >
            {tip.lines.map((l, i) => <div key={l} className={i === 0 ? "font-semibold" : "text-white"}>{l}</div>)}
          </div>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${label} over time`} aria-describedby={tableId}>
          <title>{`${label} over time`}</title>
          <desc>{`Line chart of ${label} with ${points.length} values. The values are listed in the data table below.`}</desc>
          <clipPath id={`${tableId}-clip`}><rect x={pLeft} y={pTop} width={plotW} height={plotH} /></clipPath>

          {grid.map(v => (
            <g key={v}>
              <line x1={pLeft} x2={W - pRight} y1={yS(v)} y2={yS(v)} stroke="#ffffff20" />
              <text x={pLeft - 8} y={yS(v) + 4} fill="#ffffff" fontSize={CHART_SVG_FONT_MD} textAnchor="end">{fmtAxis(v)}</text>
            </g>
          ))}

          <g clipPath={`url(#${tableId}-clip)`}>
            {bands.map(b => (
              <rect key={`${b.startT}-${b.low}-${b.high}`}
                x={xS(b.startT)} width={Math.max(0, xS(b.endT) - xS(b.startT))}
                y={clampY(yS(b.high))} height={Math.max(0, clampY(yS(b.low)) - clampY(yS(b.high)))}
                fill="#ffffff" fillOpacity="0.14" />
            ))}
          </g>

          {points.length > 1 && (
            <polyline points={points.map((p, i) => `${xS(times[i])},${yS(p.value)}`).join(" ")}
              fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          )}

          {points.map((p, i) => {
            const cx = xS(times[i])
            const cy = yS(p.value)
            return (
              <g key={`${p.date}-${p.value}-${p.reference_range}`}>
                {p.flag && <circle cx={cx} cy={cy} r="9" fill="none" stroke="#FFD700" strokeWidth="2" pointerEvents="none" />}
                {p.limit_qualifier ? (
                  <rect x={cx - 5} y={cy - 5} width="10" height="10" transform={`rotate(45 ${cx} ${cy})`}
                    fill="#1e3a5f" stroke="#ffffff" strokeWidth="2" pointerEvents="none" />
                ) : (
                  <circle cx={cx} cy={cy} r="4" fill="#ffffff" pointerEvents="none" />
                )}
                <circle cx={cx} cy={cy} r="12" fill="transparent" className="cursor-pointer" tabIndex={0}
                  aria-label={describe(p).join(", ")}
                  onMouseEnter={e => showAt(e.currentTarget, p)} onMouseLeave={() => setTip(null)}
                  onFocus={e => showAt(e.currentTarget, p)} onBlur={() => setTip(null)} />
              </g>
            )
          })}

          {xLabels.map((t, i) => (
            <text key={t} x={xS(t)} y={H - 10} fill="#ffffff" fontSize={CHART_SVG_FONT_SM}
              textAnchor={i === 0 ? "start" : i === xLabels.length - 1 ? "end" : "middle"}>
              {dateFmt(t, withYear)}
            </text>
          ))}
        </svg>
      </div>

      <ul aria-label="Key" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-white mt-1">
        {bands.length > 0 && (
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-3 w-5 rounded-sm border border-white bg-[#5E93BB]" />
            Reference range on each report
          </li>
        )}
        {points.some(p => p.limit_qualifier) && (
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rotate-45 border-2 border-white bg-fc-blue-dark" />
            Limit (above or below), not an exact reading
          </li>
        )}
        {points.some(p => p.flag) && (
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-[#FFD700]">
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
            </span>
            Differs from expected
          </li>
        )}
      </ul>

      <details className="mt-1" open={tableOpen}>
        <summary className="text-sm text-sky-100 cursor-pointer py-1">Data table</summary>
        <div id={tableId} className="overflow-x-auto">
          <table className="w-full text-xs text-white text-left">
            <caption className="sr-only">{label} values</caption>
            <thead>
              <tr className="text-text-on-brand-muted">
                <th scope="col" className="py-1 pr-2 font-medium">Date</th>
                <th scope="col" className="py-1 pr-2 font-medium">Value</th>
                <th scope="col" className="py-1 pr-2 font-medium">Unit</th>
                <th scope="col" className="py-1 pr-2 font-medium">Range</th>
                <th scope="col" className="py-1 font-medium">Flag</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p, i) => (
                <tr key={`${p.date}-${p.value}-${p.reference_range}`} className="border-t border-white/10">
                  <td className="py-1 pr-2 whitespace-nowrap">{dateFmt(p.date, true)}</td>
                  <td className="py-1 pr-2">{formatSeriesValue(p.value, p.limit_qualifier)}</td>
                  <td className="py-1 pr-2">{unit ?? ""}</td>
                  <td className="py-1 pr-2">{p.reference_range ?? ""}</td>
                  <td className="py-1">{p.flag ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
