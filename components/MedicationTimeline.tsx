// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import Button from "@/components/ui/Button"
import MarkerButton from "@/components/ui/MarkerButton"
import Surface from "@/components/ui/Surface"
import { formatDate, formatTime, formatWeekdayDate } from "@/lib/date-format"
import {
  TIMELINE_LOOKAHEAD_HOURS,
  TIMELINE_WINDOW_HOURS,
  type MedicationTimelineLane,
  type TimelineMarker,
} from "@/lib/medication/medication-timeline"
import { relativeTimeLabel, timelineTicks } from "@/lib/medication/timeline-axis"

const PX_PER_HOUR = 56
const DOMAIN_HOURS = TIMELINE_WINDOW_HOURS + TIMELINE_LOOKAHEAD_HOURS
const DOMAIN_WIDTH = DOMAIN_HOURS * PX_PER_HOUR
const ROW_HEIGHT = 44
const AXIS_HEIGHT = 20
/** Hour labels this close to "now" would collide with its label. */
const NOW_CLEARANCE_PX = 68

const fmtTime = (iso: string) => formatTime(iso)

const MARKER_LABEL: Record<TimelineMarker["kind"], string> = {
  taken: "Taken",
  upcoming: "Due",
  overdue: "Overdue since",
  missed: "Missed",
  next_eligible: "Next eligible",
}

/** Time of day, with a short weekday when it is not today (the window usually spans two days). */
function fmtWhen(iso: string, nowMs: number): string {
  const time = fmtTime(iso)
  return formatDate(iso) === formatDate(nowMs) ? time : `${formatWeekdayDate(iso)} ${time}`
}

function markerKey(lane: MedicationTimelineLane, marker: TimelineMarker): string {
  return `${lane.medicationId}-${marker.kind}-${marker.atIso}`
}

function markerHref(lane: MedicationTimelineLane, marker: TimelineMarker, personId: number): string {
  return marker.kind === "taken"
    // Taken markers are real records: link to their Live Feed entry.
    ? `/${personId}/history?highlight=${encodeURIComponent(marker.feedRowId)}`
    : `/${personId}/record-medication?medication_id=${lane.medicationId}`
}

interface MarkerProps {
  lane: MedicationTimelineLane
  marker: TimelineMarker
  x: number
  highlighted: boolean
  selected: boolean
  onSelect: () => void
}

function Marker({ lane, marker, x, highlighted, selected, onSelect }: MarkerProps) {
  const time = fmtTime(marker.atIso)
  const on = selected || highlighted

  if (marker.kind === "taken") {
    // The ring colour is never the only cue: the label and the footer say it in words, and the
    // dotted slot line shows which side of its slot the dose fell.
    const timingWords = marker.flag ? marker.flag.label.toLowerCase() : marker.timing === "on_time" ? "on time" : null
    return (
      <MarkerButton
        x={x}
        selected={selected}
        onSelect={onSelect}
        feedRowId={marker.feedRowId}
        label={`${lane.name} taken ${time}${timingWords ? `, ${timingWords}` : ""}`}
      >
        <span className={`fc-tl__dot fc-tl__dot--taken${marker.timing === "late" ? " fc-tl__dot--late" : marker.timing === "early" ? " fc-tl__dot--early" : ""}${on ? " fc-tl__dot--on" : ""}`} />
      </MarkerButton>
    )
  }

  if (marker.kind === "missed") {
    return (
      <MarkerButton x={x} selected={selected} onSelect={onSelect} label={`${lane.name} missed, ${time} dose, no dose recorded`}>
        <span aria-hidden className={`fc-tl__miss${on ? " fc-tl__miss--on" : ""}`}>✕</span>
      </MarkerButton>
    )
  }

  if (marker.kind === "next_eligible") {
    return (
      <MarkerButton x={x} selected={selected} onSelect={onSelect} label={`${lane.name} next eligible ${time}`}>
        <span className={`fc-tl__tri${selected ? " fc-tl__tri--on" : ""}`} />
      </MarkerButton>
    )
  }

  // Scheduled upcoming/overdue share a hollow ring; overdue takes its colour from the shared flag.
  const overdue = marker.kind === "overdue"
  return (
    <MarkerButton x={x} selected={selected} onSelect={onSelect} label={`${lane.name} ${overdue ? "overdue since" : "due at"} ${time}`}>
      <span className={`fc-tl__dot ${overdue ? "fc-tl__dot--overdue" : "fc-tl__dot--due"}${on ? " fc-tl__dot--on" : ""}`} />
    </MarkerButton>
  )
}

/** Lists only the marks the lanes can show: scheduled lanes get the timing states, as-needed lanes the next-eligible mark, and the cooldown and 24h cap bands appear when a lane draws them. */
function Key({ lanes }: { lanes: MedicationTimelineLane[] }) {
  const scheduled = lanes.some(l => l.kind === "scheduled")
  const prn = lanes.some(l => l.kind === "prn")
  const cooldown = lanes.some(l => l.cooldown !== null)
  const cap = lanes.some(l => l.capWindow !== null)
  const untimed = lanes.some(l => l.markers.some(m => m.kind === "taken" && m.timing === null))
  const results = scheduled || untimed || (prn && !scheduled)
  const marks = scheduled || prn || cooldown || cap
  return (
    <ul aria-label="Key" className="fc-tl__key">
      {scheduled && (
        <>
          <li><span aria-hidden className="fc-tl__dot fc-tl__dot--taken" />On time</li>
          <li><span aria-hidden className="fc-tl__dot fc-tl__dot--taken fc-tl__dot--late" />Late</li>
          <li><span aria-hidden className="fc-tl__dot fc-tl__dot--taken fc-tl__dot--early" />Early</li>
          <li><span aria-hidden className="fc-tl__miss">✕</span>Missed</li>
        </>
      )}
      {(untimed || (prn && !scheduled)) && (
        <li><span aria-hidden className="fc-tl__dot fc-tl__dot--taken" />Taken</li>
      )}
      {results && marks && <li aria-hidden className="fc-tl__keybreak" />}
      {scheduled && (
        <>
          <li><span aria-hidden className="fc-tl__dot fc-tl__dot--due" />Due</li>
          <li><span aria-hidden className="fc-tl__dot fc-tl__dot--overdue" />Overdue</li>
          <li><span aria-hidden className="fc-tl__slotkey" />Dose time</li>
        </>
      )}
      {prn && <li><span aria-hidden className="fc-tl__tri" />Next eligible</li>}
      {cooldown && <li><span aria-hidden className="fc-tl__band fc-tl__band--cooldown fc-tl__bandkey" />Cooldown</li>}
      {cap && <li><span aria-hidden className="fc-tl__band fc-tl__band--cap fc-tl__bandkey" />24h cap</li>}
    </ul>
  )
}

interface Props {
  personId: number
  lanes: MedicationTimelineLane[]
  /** Live Feed row id (e.g. `med:12`) to emphasise, from "View on timeline". */
  highlightFeedRowId?: string | null
  /** Rendered inside the status region, which supplies its own margins. */
  embedded?: boolean
  /** The dashboard has not answered yet: say so instead of claiming there is no activity. */
  loading?: boolean
}

/** Medication coverage/gap timeline: 24h trailing window plus a 6h lookahead, one lane per medication. */
export default function MedicationTimeline({ personId, lanes, highlightFeedRowId = null, embedded = false, loading = false }: Props) {
  const router = useRouter()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  // Re-anchored whenever the dashboard refresh delivers new lanes, so the axis and "now" line
  // stay in step with the server-computed markers.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `lanes` is the refresh signal
  const now = useMemo(() => Date.now(), [lanes])
  const windowStart = now - TIMELINE_WINDOW_HOURS * 3_600_000
  const xFor = (iso: string) => ((new Date(iso).getTime() - windowStart) / 3_600_000) * PX_PER_HOUR
  // A band can start before the window or run past the look ahead (a 24h cap ends a day after its dose), so it stops at the edges.
  const bandStyle = (band: { startIso: string; endIso: string }) => {
    const left = Math.max(xFor(band.startIso), 0)
    const right = Math.min(xFor(band.endIso), DOMAIN_WIDTH)
    return { left, width: Math.max(right - left, 2) }
  }
  const nowX = TIMELINE_WINDOW_HOURS * PX_PER_HOUR
  const ticks = timelineTicks(windowStart, windowStart + DOMAIN_HOURS * 3_600_000)
  let selected: { lane: MedicationTimelineLane; marker: TimelineMarker } | null = null
  for (const lane of lanes) {
    const marker = lane.markers.find(m => markerKey(lane, m) === selectedKey)
    if (marker) selected = { lane, marker }
  }

  // "Now" opens at about half the visible width (some history and some lookahead in view); the rest
  // of the trailing 24h is reachable by scrolling left. A highlighted marker scrolls into view instead.
  // The scroll area only exists once there are lanes (the panel is mounted before the dashboard answers),
  // so this also runs when the lanes first arrive, not only on mount.
  const hasLanes = lanes.length > 0
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !hasLanes) return
    const target = highlightFeedRowId
      ? el.querySelector<HTMLElement>(`[data-timeline-feed-row-id="${CSS.escape(highlightFeedRowId)}"]`)
      : null
    if (target) target.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
    else el.scrollTo({ left: Math.max(nowX - el.clientWidth / 2, 0) })
  }, [nowX, highlightFeedRowId, hasLanes])

  function select(lane: MedicationTimelineLane, marker: TimelineMarker) {
    const key = markerKey(lane, marker)
    // A second tap on the selected marker opens its record.
    if (key === selectedKey) router.push(markerHref(lane, marker, personId))
    else setSelectedKey(key)
  }

  return (
    <div className={embedded ? undefined : "shrink-0 mx-4 mt-3"}>
      <Surface kind="dark" className="fc-status-card">
        <div className="fc-tl__head">
          <span>Medication timeline</span>
          <span className="fc-tl__muted">{TIMELINE_WINDOW_HOURS}h window</span>
        </div>
        {lanes.length === 0 ? (
          <div className="fc-status-empty" role="status">
            <span>{loading ? "Loading…" : "No recent or upcoming medication activity"}</span>
          </div>
        ) : (
        <>
        <div ref={scrollRef} className="fc-tl__scroll">
          <div className="relative" style={{ width: DOMAIN_WIDTH }}>
            <div className="fc-tl__axis" style={{ width: DOMAIN_WIDTH, height: AXIS_HEIGHT }} aria-hidden>
              {ticks.map(t => {
                const x = ((t.atMs - windowStart) / 3_600_000) * PX_PER_HOUR
                if (!t.midnight && Math.abs(x - nowX) < NOW_CLEARANCE_PX) return null
                return t.midnight ? (
                  <span key={t.atMs} className="fc-tl__tick fc-tl__tick--day" style={{ left: x }}>
                    {formatWeekdayDate(t.atMs)}
                  </span>
                ) : (
                  <span key={t.atMs} className="fc-tl__tick" style={{ left: x }}>
                    {formatTime(t.atMs)}
                  </span>
                )
              })}
              <span className="fc-tl__now" style={{ left: nowX }}>
                now {fmtTime(new Date(now).toISOString())}
              </span>
            </div>
            {ticks.filter(t => t.midnight).map(t => (
              <div key={t.atMs} aria-hidden className="fc-tl__midnight"
                style={{ left: ((t.atMs - windowStart) / 3_600_000) * PX_PER_HOUR, top: AXIS_HEIGHT }} />
            ))}
            <div className="fc-tl__nowline" style={{ left: nowX, top: AXIS_HEIGHT }} />
            {lanes.map(lane => (
              <div key={lane.medicationId} className="fc-tl__lane" style={{ width: DOMAIN_WIDTH, height: ROW_HEIGHT }}>
                <div className="fc-tl__lane-name">
                  {lane.name}
                  {lane.coverageGap && <span className="fc-tl__flag fc-tl__flag--gap" aria-label="Coverage gap">⚠</span>}
                  {lane.atCap && <span className="fc-tl__flag fc-tl__flag--cap" aria-label="At 24h cap">⛔</span>}
                </div>
                <div className="fc-tl__track">
                  {lane.cooldown && (
                    <div
                      className="fc-tl__band fc-tl__band--cooldown"
                      style={bandStyle(lane.cooldown)}
                      title={`Cooldown until ${fmtTime(lane.cooldown.endIso)}`}
                    />
                  )}
                  {lane.capWindow && (
                    <div
                      className="fc-tl__band fc-tl__band--cap"
                      style={bandStyle(lane.capWindow)}
                      title={`24h cap window resets ${fmtTime(lane.capWindow.endIso)}`}
                    />
                  )}
                  {lane.slotLines.map(iso => (
                    <div key={iso} aria-hidden className="fc-tl__slotline" style={{ left: xFor(iso) }} />
                  ))}
                  {!lane.markers.some(m => m.kind === "taken") && (
                    <span className="fc-tl__none">No doses in this window</span>
                  )}
                  {lane.markers.map(marker => (
                    <Marker
                      key={markerKey(lane, marker)}
                      lane={lane}
                      marker={marker}
                      x={xFor(marker.atIso)}
                      highlighted={marker.kind === "taken" && marker.feedRowId === highlightFeedRowId}
                      selected={markerKey(lane, marker) === selectedKey}
                      onSelect={() => select(lane, marker)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <Key lanes={lanes} />
        <div className="fc-tl__foot" role="status" aria-live="polite">
          {selected ? (
            <>
              <span>
                <strong>{selected.lane.name}</strong>
                {" · "}{MARKER_LABEL[selected.marker.kind]} {fmtWhen(selected.marker.atIso, now)}
                {" · "}{relativeTimeLabel(new Date(selected.marker.atIso).getTime(), now)}
                {selected.marker.kind === "taken" && selected.marker.timing === "on_time" && <span> · on time</span>}
                {selected.marker.flag && (
                  <span className={`fc-tl__foot-flag fc-tl__foot-flag--${selected.marker.flag.level}`}> · {selected.marker.flag.label.toLowerCase()}</span>
                )}
              </span>
              <Button variant="secondary" href={markerHref(selected.lane, selected.marker, personId)}>
                {selected.marker.kind === "taken" ? "Open" : "Record"}
              </Button>
            </>
          ) : (
            <span>Tap a dose to see its time.</span>
          )}
        </div>
        </>
        )}
      </Surface>
    </div>
  )
}
