// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { CHART_SVG_FONT_MD, CHART_SVG_FONT_SM } from "@/lib/chart-svg-typography"

import { formatHydration } from "@/lib/format"
import { localDateToIsoYmd } from "@/lib/datetime"
import { toMl } from "@/lib/observation/observation-unit-conversion"

interface HydrationBarChartProps {
  data: Array<{ date: string; value: number; unit: string }>
  goalMl?: number
  /** id of adjacent data table on the history screen (aria-describedby). */
  describedById?: string
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

function localDateKey(iso: string): string {
  return localDateToIsoYmd(new Date(iso))
}

function fmtDateLabel(key: string): string {
  const [, m, d] = key.split("-").map(Number)
  return `${d} ${MONTHS[m - 1]}`
}

export default function HydrationBarChart({ data, goalMl, describedById }: HydrationBarChartProps) {
  const byDay = new Map<string, number>()
  for (const r of data) {
    const key = localDateKey(r.date)
    byDay.set(key, (byDay.get(key) ?? 0) + toMl(r.value, r.unit))
  }
  const days = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))

  if (days.length === 0) {
    return (
      <p className="text-white/70 text-center py-4 text-sm">
        No hydration records in selected period.
      </p>
    )
  }

  const W = 800
  const H = 280
  const pTop = 20
  const pRight = 48
  const pBottom = 50
  const pLeft = 62
  const plotW = W - pLeft - pRight
  const plotH = H - pTop - pBottom

  const maxTotal = Math.max(...days.map(([, v]) => v), goalMl ?? 0)
  const yMax = maxTotal === 0 ? 1000 : maxTotal * 1.1
  const yS = (v: number) => pTop + plotH - (v / yMax) * plotH

  const barW = Math.max(4, Math.min(60, (plotW / days.length) * 0.7))
  const xS = (i: number) => pLeft + (i + 0.5) * (plotW / days.length)

  const labelStep = days.length <= 7 ? 1 : days.length <= 14 ? 2 : Math.ceil(days.length / 6)

  const gridCount = 4
  const gridLines = Array.from({ length: gridCount + 1 }, (_, i) => {
    const v = (yMax * i) / gridCount
    return { y: yS(v), v }
  })

  return (
    <div>
      <div
        className="line-chart-wrap relative"
        {...(describedById ? { "aria-describedby": describedById } : {})}
      >
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Hydration daily totals">
          <title>Hydration daily totals</title>
          <desc>
            {describedById
              ? "Bar chart of daily hydration totals. Detailed values are listed in the accompanying records table."
              : `Bar chart of daily hydration totals across ${days.length} days.`}
          </desc>

          <text
            x={pLeft / 2 - 6}
            y={pTop + plotH / 2}
            fill="#ffffff"
            fontSize={CHART_SVG_FONT_MD}
            textAnchor="middle"
            transform={`rotate(-90 ${pLeft / 2 - 6} ${pTop + plotH / 2})`}
          >
            Value (mL)
          </text>

          {gridLines.map((g, i) => (
            <line key={i} x1={pLeft} y1={g.y} x2={W - pRight} y2={g.y}
              stroke="#ffffff20" strokeWidth="1" />
          ))}
          {gridLines.map((g, i) => (
            <text key={i} x={pLeft - 8} y={g.y + 4}
              fill="#ffffff" fontSize={CHART_SVG_FONT_MD} textAnchor="end">
              {formatHydration(g.v)}
            </text>
          ))}

          {/* TODO: goal line colours → CSS vars for theme support */}
          {goalMl !== undefined && (
            <>
              <line x1={pLeft} y1={yS(goalMl)} x2={W - pRight} y2={yS(goalMl)}
                stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeDasharray="4 3" />
              <text x={W - pRight + 4} y={yS(goalMl) + 4} fill="#ffffff" fontSize={CHART_SVG_FONT_SM}>
                {formatHydration(goalMl)}
              </text>
            </>
          )}

          {days.map(([key, total], i) => {
            const x = xS(i)
            const barTop = yS(total)
            const barH = (pTop + plotH) - barTop
            const reachedGoal = goalMl !== undefined && total >= goalMl
            const fill = reachedGoal ? "#4ade80" : "rgba(255,255,255,0.7)"
            return (
              <rect
                key={key}
                x={x - barW / 2}
                y={barTop}
                width={barW}
                height={Math.max(barH, 1)}
                fill={fill}
                rx="2"
              />
            )
          })}

          {days.map(([key], i) => {
            if (i % labelStep !== 0) return null
            return (
              <text key={key} x={xS(i)} y={H - pBottom + 18}
                fill="#ffffff" fontSize={CHART_SVG_FONT_MD} textAnchor="middle">
                {fmtDateLabel(key)}
              </text>
            )
          })}

          <text x={(pLeft + W - pRight) / 2} y={H - 8} fill="#ffffff" fontSize={CHART_SVG_FONT_SM} textAnchor="middle">
            Date
          </text>
        </svg>
      </div>

      {goalMl !== undefined && (
        <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm text-white">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm bg-green-400" />
            Goal reached ({formatHydration(goalMl)})
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-px w-5 shrink-0 border-t border-dashed border-white/60" />
            Daily goal
          </span>
        </div>
      )}
    </div>
  )
}
