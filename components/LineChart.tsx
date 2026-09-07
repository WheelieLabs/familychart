// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useRef, useState, type MouseEvent } from "react"
import { CHART_SVG_FONT_MD, CHART_SVG_FONT_SM } from "@/lib/chart-svg-typography"

interface DataPoint {
  date: string
  value: number
}

interface LineChartProps {
  data: DataPoint[]
  unit: string
  label: string
  /** Second line — same-length series is typical (e.g. BP diastolic). */
  secondaryData?: DataPoint[]
  primaryColor?: string
  secondaryColor?: string
  primaryLabel?: string
  secondaryLabel?: string
  /** Range goal lower bound — renders two dashed horizontal reference lines */
  goalMin?: number
  /** Range goal upper bound */
  goalMax?: number
  /** Trend or daily_min reference line */
  goalTarget?: number
  /** ISO date for vertical deadline line */
  goalDate?: string
  /** Override the auto-generated legend label for the goal */
  goalLabel?: string
  /** id of adjacent data table on the history screen (aria-describedby). */
  describedById?: string
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const MS_PER_DAY = 86400000

function fmtChartDate(iso: string, spanMs: number): string {
  const d = new Date(iso)
  const day = d.getDate()
  const mon = MONTHS[d.getMonth()]
  if (spanMs > 60 * MS_PER_DAY) {
    const y = d.getFullYear()
    return `${day} ${mon} '${String(y).slice(-2)}`
  }
  return `${day} ${mon}`
}

function fmtVal(v: number): string {
  if (Math.abs(v) >= 100) return Math.round(v).toString()
  return (Math.round(v * 10) / 10).toString()
}

function pointAriaLabel(series: string, d: DataPoint, unit: string, spanMs: number): string {
  const value = `${fmtVal(d.value)}${unit ? ` ${unit}` : ""}`
  return `${series}, ${value}, ${fmtChartDate(d.date, spanMs)}`
}

type TooltipState = {
  px: number
  py: number
  lines: string[]
}

export default function LineChart({
  data,
  unit,
  label,
  secondaryData,
  // TODO: convert to CSS vars when themes introduced — hardcoded hex does not support dark/high-contrast themes
  primaryColor = "#ffffff",
  secondaryColor = "#FFD700",
  primaryLabel = "Systolic",
  secondaryLabel = "Diastolic",
  goalMin,
  goalMax,
  goalTarget,
  goalDate,
  goalLabel,
  describedById,
}: LineChartProps) {
  const dual = !!(secondaryData && secondaryData.length > 0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const hideTooltip = useCallback(() => setTooltip(null), [])

  const showTooltipClient = useCallback((e: MouseEvent, lines: string[]) => {
    const wrap = wrapRef.current
    if (!wrap) return
    const r = wrap.getBoundingClientRect()
    setTooltip({
      px: e.clientX - r.left,
      py: e.clientY - r.top,
      lines,
    })
  }, [])

  const pointEnter = useCallback(
    (e: MouseEvent, seriesTitle: string, d: DataPoint) => {
      const lines = [
        seriesTitle,
        `${fmtVal(d.value)}${unit ? ` ${unit}` : ""}`,
        fmtChartDate(d.date, Number.POSITIVE_INFINITY),
      ]
      showTooltipClient(e, lines)
    },
    [showTooltipClient, unit],
  )

  if (dual) {
    if (data.length < 2 || secondaryData!.length < 2) {
      return (
        <p className="text-white/70 text-center py-4 text-sm">
          Not enough data to display a chart — need at least 2 paired readings.
        </p>
      )
    }
  } else if (data.length < 2) {
    return (
      <p className="text-white/70 text-center py-4 text-sm">
        Not enough data to display a chart — need at least 2 observations.
      </p>
    )
  }

  const W = 800
  const H = 300
  const pTop = 28
  const pRight = 28
  const pBottom = 58
  const pLeft = 62
  const plotW = W - pLeft - pRight
  const plotH = H - pTop - pBottom

  const timesPrimary = data.map(d => new Date(d.date).getTime())
  const timesSecondary = dual ? secondaryData!.map(d => new Date(d.date).getTime()) : []
  const times = [...timesPrimary, ...timesSecondary]
  const values = [...data.map(d => d.value), ...(dual ? secondaryData!.map(d => d.value) : [])]

  const minT = Math.min(...times)
  const maxT = Math.max(...times)
  const spanMs = maxT - minT

  const allValuesForRange = [...values]
  if (goalMin !== undefined) allValuesForRange.push(goalMin)
  if (goalMax !== undefined) allValuesForRange.push(goalMax)
  if (goalTarget !== undefined) allValuesForRange.push(goalTarget)

  const minV = Math.min(...allValuesForRange)
  const maxV = Math.max(...allValuesForRange)

  const rawRange = maxV - minV
  const yMin = rawRange === 0 ? minV - 1 : minV - rawRange * 0.1
  const yMax = rawRange === 0 ? maxV + 1 : maxV + rawRange * 0.1

  const xS = (t: number) =>
    maxT === minT ? pLeft + plotW / 2 : pLeft + ((t - minT) / (maxT - minT)) * plotW
  const yS = (v: number) => pTop + plotH - ((v - yMin) / (yMax - yMin)) * plotH

  const gridCount = 5
  const gridLines = Array.from({ length: gridCount }, (_, i) => {
    const v = yMin + (yMax - yMin) * i / (gridCount - 1)
    return { y: yS(v), v }
  })

  const labelCount = Math.min(6, data.length)
  const xLabels = Array.from({ length: labelCount }, (_, i) => {
    const idx = Math.round(i * (data.length - 1) / (labelCount - 1))
    return {
      x: xS(timesPrimary[idx]),
      text: fmtChartDate(data[idx].date, spanMs),
    }
  })

  const pointsPrimary = data.map(d => `${xS(new Date(d.date).getTime())},${yS(d.value)}`).join(' ')
  const pointsSecondary = dual
    ? secondaryData!.map(d => `${xS(new Date(d.date).getTime())},${yS(d.value)}`).join(' ')
    : ""

  const yAxisCaption = unit ? `Value (${unit})` : "Value"
  const chartPurposeLabel = `${label} over time`
  const chartDesc = describedById
    ? `Line chart of ${label}. Detailed values are listed in the accompanying records table.`
    : `Line chart of ${label} with ${data.length} data points.`

  return (
    <div>
      <div
        ref={wrapRef}
        className="line-chart-wrap relative"
        {...(describedById ? { "aria-describedby": describedById } : {})}
      >
        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 max-w-[240px] rounded-md border border-white/25 bg-gray-950/95 px-2.5 py-1.5 text-left text-xs text-white shadow-lg"
            style={{
              left: tooltip.px,
              top: tooltip.py,
              transform: "translate(-50%, calc(-100% - 8px))",
            }}
            role="tooltip"
          >
            {tooltip.lines.map((line, i) => (
              <div key={i} className={i === 0 ? "font-semibold text-white" : "text-white/90"}>
                {line}
              </div>
            ))}
          </div>
        )}

        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={chartPurposeLabel}>
          <title>{chartPurposeLabel}</title>
          <desc>{chartDesc}</desc>

          <text
            x={pLeft / 2 - 6}
            y={pTop + plotH / 2}
            fill="#ffffff"
            fontSize={CHART_SVG_FONT_MD}
            textAnchor="middle"
            transform={`rotate(-90 ${pLeft / 2 - 6} ${pTop + plotH / 2})`}
          >
            {yAxisCaption}
          </text>

          {gridLines.map((g, i) => (
            <line key={i} x1={pLeft} y1={g.y} x2={W - pRight} y2={g.y}
              stroke="#ffffff20" strokeWidth="1" />
          ))}

          {gridLines.map((g, i) => (
            <text key={i} x={pLeft - 8} y={g.y + 4}
              fill="#ffffff" fontSize={CHART_SVG_FONT_MD} textAnchor="end">
              {fmtVal(g.v)}
            </text>
          ))}

          {/* TODO: goal line colours → CSS vars for theme support */}
          {goalMin !== undefined && goalMax !== undefined && (
            <>
              <line x1={pLeft} y1={yS(goalMin)} x2={W - pRight} y2={yS(goalMin)}
                stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeDasharray="4 3" />
              <line x1={pLeft} y1={yS(goalMax)} x2={W - pRight} y2={yS(goalMax)}
                stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeDasharray="4 3" />
              <text x={W - pRight + 4} y={yS(goalMin) + 4} fill="#ffffff" fontSize={CHART_SVG_FONT_SM}>
                {fmtVal(goalMin)}
              </text>
              <text x={W - pRight + 4} y={yS(goalMax) + 4} fill="#ffffff" fontSize={CHART_SVG_FONT_SM}>
                {fmtVal(goalMax)}
              </text>
            </>
          )}
          {goalTarget !== undefined && goalMin === undefined && (
            <>
              <line x1={pLeft} y1={yS(goalTarget)} x2={W - pRight} y2={yS(goalTarget)}
                stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
              <text x={W - pRight + 4} y={yS(goalTarget) + 4} fill="#ffffff" fontSize={CHART_SVG_FONT_SM}>
                {fmtVal(goalTarget)}
              </text>
            </>
          )}
          {goalDate && (() => {
            const goalDateMs = new Date(goalDate).getTime()
            if (goalDateMs < minT || goalDateMs > maxT) return null
            return (
              <line x1={xS(goalDateMs)} y1={pTop} x2={xS(goalDateMs)} y2={pTop + plotH}
                stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeDasharray="4 3" />
            )
          })()}

          {dual ? (
            <>
              <polyline points={pointsPrimary} fill="none" stroke={primaryColor} strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round" />
              <polyline points={pointsSecondary} fill="none" stroke={secondaryColor} strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round" />
              {data.map((d, i) => (
                <circle key={`p-${i}`}
                  cx={xS(new Date(d.date).getTime())}
                  cy={yS(d.value)}
                  r="10" fill="transparent" className="cursor-pointer"
                  aria-label={pointAriaLabel(primaryLabel, d, unit, spanMs)}
                  onMouseEnter={e => pointEnter(e, primaryLabel, d)}
                  onMouseLeave={hideTooltip}
                  onFocus={e => {
                    const wrap = wrapRef.current
                    if (!wrap) return
                    const circle = e.currentTarget
                    const br = circle.getBoundingClientRect()
                    const wr = wrap.getBoundingClientRect()
                    setTooltip({
                      px: br.left - wr.left + br.width / 2,
                      py: br.top - wr.top,
                      lines: [
                        primaryLabel,
                        `${fmtVal(d.value)}${unit ? ` ${unit}` : ""}`,
                        fmtChartDate(d.date, spanMs),
                      ],
                    })
                  }}
                  onBlur={hideTooltip}
                  tabIndex={0}
                />
              ))}
              {data.map((d, i) => (
                <circle key={`pv-${i}`}
                  cx={xS(new Date(d.date).getTime())}
                  cy={yS(d.value)}
                  r="4" fill={primaryColor} pointerEvents="none" />
              ))}
              {secondaryData!.map((d, i) => (
                <circle key={`s-${i}`}
                  cx={xS(new Date(d.date).getTime())}
                  cy={yS(d.value)}
                  r="10" fill="transparent" className="cursor-pointer"
                  aria-label={pointAriaLabel(secondaryLabel, d, unit, spanMs)}
                  onMouseEnter={e => pointEnter(e, secondaryLabel, d)}
                  onMouseLeave={hideTooltip}
                  onFocus={e => {
                    const wrap = wrapRef.current
                    if (!wrap) return
                    const circle = e.currentTarget
                    const br = circle.getBoundingClientRect()
                    const wr = wrap.getBoundingClientRect()
                    setTooltip({
                      px: br.left - wr.left + br.width / 2,
                      py: br.top - wr.top,
                      lines: [
                        secondaryLabel,
                        `${fmtVal(d.value)}${unit ? ` ${unit}` : ""}`,
                        fmtChartDate(d.date, spanMs),
                      ],
                    })
                  }}
                  onBlur={hideTooltip}
                  tabIndex={0}
                />
              ))}
              {secondaryData!.map((d, i) => (
                <circle key={`sv-${i}`}
                  cx={xS(new Date(d.date).getTime())}
                  cy={yS(d.value)}
                  r="4" fill={secondaryColor} pointerEvents="none" />
              ))}
            </>
          ) : (
            <>
              <polyline points={pointsPrimary} fill="none" stroke={primaryColor} strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round" />
              {data.map((d, i) => (
                <circle key={`h-${i}`}
                  cx={xS(new Date(d.date).getTime())}
                  cy={yS(d.value)}
                  r="10" fill="transparent" className="cursor-pointer"
                  aria-label={pointAriaLabel(label, d, unit, spanMs)}
                  onMouseEnter={e => pointEnter(e, label, d)}
                  onMouseLeave={hideTooltip}
                  onFocus={e => {
                    const wrap = wrapRef.current
                    if (!wrap) return
                    const circle = e.currentTarget
                    const br = circle.getBoundingClientRect()
                    const wr = wrap.getBoundingClientRect()
                    setTooltip({
                      px: br.left - wr.left + br.width / 2,
                      py: br.top - wr.top,
                      lines: [
                        label,
                        `${fmtVal(d.value)}${unit ? ` ${unit}` : ""}`,
                        fmtChartDate(d.date, spanMs),
                      ],
                    })
                  }}
                  onBlur={hideTooltip}
                  tabIndex={0}
                />
              ))}
              {data.map((d, i) => {
                const outOfRange =
                  goalMin !== undefined &&
                  goalMax !== undefined &&
                  (d.value < goalMin || d.value > goalMax)
                return (
                  <circle key={i}
                    cx={xS(new Date(d.date).getTime())}
                    cy={yS(d.value)}
                    r="4" fill={outOfRange ? "#FFD700" : primaryColor} pointerEvents="none" />
                )
              })}
            </>
          )}

          {xLabels.map((lab, i) => (
            <text key={i} x={lab.x} y={H - pBottom + 18}
              fill="#ffffff" fontSize={CHART_SVG_FONT_MD} textAnchor="middle">
              {lab.text}
            </text>
          ))}

          <text x={(pLeft + W - pRight) / 2} y={H - 8} fill="#ffffff" fontSize={CHART_SVG_FONT_SM} textAnchor="middle">
            Date
          </text>
        </svg>
      </div>

      {dual && (
        <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm text-white">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: primaryColor }} />
            {primaryLabel}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: secondaryColor }} />
            {secondaryLabel}
          </span>
        </div>
      )}

      {(goalMin !== undefined || goalTarget !== undefined) && (
        <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm text-white">
          {goalMin !== undefined && goalMax !== undefined && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-px w-5 shrink-0 border-t border-dashed border-white/60" />
              {goalLabel ?? `Target range: ${fmtVal(goalMin)}–${fmtVal(goalMax)} ${unit}`}
            </span>
          )}
          {goalTarget !== undefined && goalMin === undefined && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-px w-5 shrink-0 border-t border-white/60" />
              {(() => {
                let lbl = goalLabel ?? `Goal: ${fmtVal(goalTarget)} ${unit}`
                if (goalDate) lbl += ` by ${fmtChartDate(goalDate, Number.POSITIVE_INFINITY)}`
                return lbl
              })()}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
