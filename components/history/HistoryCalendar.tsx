// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import type { ReactNode } from "react"
import { FEED_KIND_META, FEED_KINDS, FeedKindChips } from "@/components/history/history-parts"
import DayButton from "@/components/ui/DayButton"
import IconButton from "@/components/ui/IconButton"
import { formatDate } from "@/lib/date-format"
import type { FeedChipKind, FeedRow } from "@/lib/history/feed"
import { buildCalendarGrid, capDots, monthLabel, type CalendarDayCell, type SymptomSegment } from "@/lib/history/calendar-grid"

/**
 * Shape of one day's piece of a symptom line: rounded caps only at the span's true start and end,
 * and a bridge over the grid gap on any side that continues, so the line reads as one bar.
 */
function symptomBarShape(seg: SymptomSegment): string {
  return (
    (seg.isStart ? "rounded-l-full ml-1.5 " : "-ml-0.5 ") +
    (seg.isEnd ? "rounded-r-full mr-1.5" : "-mr-0.5")
  )
}

/** Smallest height of one week row: the date, a dot row and up to three symptom lines stay legible. */
const CALENDAR_MIN_ROW = "3.5rem"

/** Screen-reader label for a day cell: the dots and lines are decorative, so say what is on the day. */
function calendarCellLabel(cell: CalendarDayCell): string {
  const records = cell.kinds.length + cell.symptomLabels.length
  const day = formatDate(cell.ymd)
  const count = `${records} ${records === 1 ? "entry" : "entries"}`
  return cell.symptomLabels.length > 0 ? `${day}, ${count}. Symptoms: ${cell.symptomLabels.join(", ")}` : `${day}, ${count}`
}

function CalendarKindLegend() {
  return (
    <ul className="fc-legend" aria-label="Key">
      {FEED_KINDS.map(k => (
        <li key={k}>
          {/* A symptom is a line across the days it covers; the other kinds are dots. */}
          <span
            aria-hidden="true"
            className="fc-dot-kind"
            style={{ backgroundColor: FEED_KIND_META[k].dotColor, ...(k === "symptom" ? { width: 16, height: 4 } : { width: 8, height: 8 }) }}
          />
          {FEED_KIND_META[k].label}
        </li>
      ))}
    </ul>
  )
}

interface HistoryCalendarProps {
  month: string
  onShiftMonth: (delta: number) => void
  kindFilter: FeedChipKind | "all"
  onKindFilter: (kind: FeedChipKind | "all") => void
  loading: boolean
  grid: ReturnType<typeof buildCalendarGrid>
  selectedDay: string | null
  onSelectDay: (day: string | null) => void
  dayRows: readonly FeedRow[]
  renderRow: (row: FeedRow) => ReactNode
}

/** The Calendar tab: month navigation, the kind filter and key, the day grid and the day's bottom sheet. */
export default function HistoryCalendar({
  month,
  onShiftMonth,
  kindFilter,
  onKindFilter,
  loading,
  grid,
  selectedDay,
  onSelectDay,
  dayRows,
  renderRow,
}: HistoryCalendarProps) {
  const weeks = Math.ceil(grid.length / 7)
  return (
    // Fills the page so the grid takes the screen left under the controls; the page scrolls when that is
    // less than the grid's minimum height (a small screen or a large text size).
    <div className="fc-history fc-history--fill">
      <div className="fc-cal-nav">
        <IconButton label="Previous month" onClick={() => onShiftMonth(-1)}>‹</IconButton>
        <h2 className="fc-cal-nav__month" aria-live="polite">{monthLabel(month)}</h2>
        <IconButton label="Next month" onClick={() => onShiftMonth(1)}>›</IconButton>
      </div>

      <FeedKindChips value={kindFilter} onChange={onKindFilter} />
      <CalendarKindLegend />

      {loading && <p className="fc-admin-note">Loading…</p>}

      {!loading && (
        <div
          className="fc-cal-stage"
          style={{ minHeight: `calc(1.75rem + ${weeks} * (${CALENDAR_MIN_ROW} + 0.25rem))` }}
        >
          <div
            className="grid grid-cols-7 gap-1 h-full"
            style={{ gridTemplateRows: `auto repeat(${weeks}, minmax(${CALENDAR_MIN_ROW}, 1fr))` }}
          >
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
              <div key={d} className="fc-weekday" aria-hidden="true">{d}</div>
            ))}
            {grid.map(cell => (
              <DayButton
                key={cell.ymd}
                label={calendarCellLabel(cell)}
                selected={selectedDay === cell.ymd}
                outside={!cell.inMonth}
                onSelect={() => onSelectDay(selectedDay === cell.ymd ? null : cell.ymd)}
                style={cell.symptomLanes.length > 0 ? { paddingBottom: cell.symptomLanes.length * 6 + 2 } : undefined}
              >
                <span aria-hidden="true">{Number(cell.ymd.slice(8, 10))}</span>
                {(cell.kinds.length > 0 || cell.hiddenSymptoms > 0) && (() => {
                  const { dots, more } = capDots(cell.kinds)
                  const extra = more + cell.hiddenSymptoms
                  return (
                    <span aria-hidden="true" className="fc-dots">
                      {dots.map(({ kind, key }) => (
                        <span key={key} className="fc-dot-kind" style={{ backgroundColor: FEED_KIND_META[kind].dotColor }} />
                      ))}
                      {extra > 0 && <span className="fc-dots__more">+{extra}</span>}
                    </span>
                  )
                })()}
                {cell.symptomLanes.length > 0 && (
                  <span aria-hidden="true" className="fc-day__lanes">
                    {cell.symptomLanes.map((seg, lane) => (
                      // eslint-disable-next-line react-x/no-array-index-key -- a lane is a positional slot, its index is its identity
                      <span key={lane} className={"fc-day__lane " + (seg ? symptomBarShape(seg) : "")}
                        style={seg ? { backgroundColor: FEED_KIND_META.symptom.dotColor } : undefined} />
                    ))}
                  </span>
                )}
              </DayButton>
            ))}
          </div>
        </div>
      )}

      {/* Bottom sheet: docks to the bottom of the visible page on day-select, never pushes the grid out of view. */}
      <div className="fc-sheet-dock">
        <div
          className={`fc-sheet${selectedDay ? "" : " fc-sheet--closed"}`}
          data-surface="dark"
          aria-hidden={!selectedDay}
          inert={!selectedDay}
        >
          <div className="fc-sheet__head">
            <p className="fc-sheet__title">
              {selectedDay && `${formatDate(selectedDay)} — ${dayRows.length} entr${dayRows.length === 1 ? "y" : "ies"}`}
            </p>
            <IconButton label="Close" onClick={() => onSelectDay(null)}>✕</IconButton>
          </div>
          <div className="fc-sheet__body fc-scroll">
            {dayRows.length === 0
              ? <p className="fc-admin-note">No records on this day.</p>
              : <ul className="fc-card-list">{dayRows.map(row => renderRow(row))}</ul>
            }
          </div>
        </div>
      </div>
    </div>
  )
}
