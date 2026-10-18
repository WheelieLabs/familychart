// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import SlideTabs from "@/components/ui/SlideTabs"
import { initialStatusSlide, statusSlides, type StatusSlide } from "@/lib/person/action-screen"

interface Props {
  hasAlerts: boolean
  /** The alerts slide has a quiet line to show (a Missed dose) even with no alert, so it still opens first. */
  hasNotices?: boolean
  alertSeverity: "red" | "amber" | "notice"
  /** Number of alerts, announced on the alerts tab. */
  alertCount: number
  alertsSlide: ReactNode
  /** The medication timeline panel (it renders its own empty state). */
  timelineSlide: ReactNode
  /** True when the timeline has lanes to show; decides whether it opens first when there are no alerts. */
  timelineHasContent: boolean
  /** The dashboard has loaded, so the starting slide can be decided from real data (not before). */
  ready: boolean
  /** `?timeline=<row id>` from the Live Feed "View on timeline" link; forces the timeline slide first. */
  timelineParam: string | null
}

const SLIDES = statusSlides()
const SLIDE_LABEL: Record<StatusSlide, string> = { alerts: "Alerts", timeline: "Medication timeline" }

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * One swipeable status region holding the alerts and the medication timeline. Opens on alerts
 * when any exist (or on the timeline when asked via `timelineParam`), otherwise on the timeline.
 * Operable without swiping: the page indicator is a tablist (arrow keys, Home/End) and slides
 * jump rather than animate under reduced motion.
 */
export default function StatusRegion({
  hasAlerts, hasNotices = false, alertSeverity, alertCount, alertsSlide, timelineSlide, timelineHasContent, ready, timelineParam,
}: Props) {
  const slides = SLIDES
  const scrollRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  // Opens once per `timelineParam` value, when data first determines the starting slide; dashboard
  // refreshes never yank the view, but a new `?timeline=` link re-opens the timeline.
  const openedFor = useRef<string | null | undefined>(undefined)

  const goTo = useCallback((index: number, smooth: boolean) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ left: index * el.clientWidth, behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto" })
    setActive(index)
  }, [])

  useEffect(() => {
    if (!ready || openedFor.current === timelineParam) return
    openedFor.current = timelineParam
    const start = initialStatusSlide({ hasAlerts: hasAlerts || hasNotices, hasTimelineContent: timelineHasContent, timelineParam })
    goTo(slides.indexOf(start), false)
  }, [ready, hasAlerts, hasNotices, timelineHasContent, timelineParam, slides, goTo])

  return (
    <div className="fc-status-region">
      <div
        ref={scrollRef}
        onScroll={e => {
          const el = e.currentTarget
          if (el.clientWidth > 0) setActive(Math.round(el.scrollLeft / el.clientWidth))
        }}
        className="fc-status-slides"
      >
        {slides.map((slide, i) => (
          <div key={slide} role="tabpanel" id={`status-slide-${slide}`} aria-label={SLIDE_LABEL[slide]}
            // Off-screen slides are skipped by keyboard and assistive tech; the tabs reach them.
            inert={active !== i}
            className="fc-status-slide">
            {slide === "alerts" ? alertsSlide : timelineSlide}
          </div>
        ))}
      </div>

      <SlideTabs
        label="Status view"
        active={active}
        onSelect={index => goTo(index, true)}
        tabs={slides.map(slide => ({
          id: slide,
          controls: `status-slide-${slide}`,
          label: slide === "alerts"
            ? `Alerts${alertCount > 0 ? `, ${alertCount} need attention` : ", none"}`
            : SLIDE_LABEL[slide],
          badge: slide === "alerts" && hasAlerts ? alertSeverity : undefined,
        }))}
      />
    </div>
  )
}
