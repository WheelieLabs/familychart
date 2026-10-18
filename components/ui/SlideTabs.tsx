// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useRef, type KeyboardEvent } from "react"

export interface SlideTab {
  id: string
  /** The accessible name of the dot. */
  label: string
  /** The panel this tab controls. */
  controls: string
  /** A small marker on an unselected tab (an alert waiting on another slide). */
  badge?: "red" | "amber" | "notice"
}

/**
 * The page indicator under a swipeable region: a tablist of dots (the selected one is long). Arrow
 * keys, Home and End move between slides, so the region is operable without swiping. The marker
 * shape and colour never carry the meaning alone: the tab's name does.
 */
export default function SlideTabs({
  label,
  tabs,
  active,
  onSelect,
}: {
  label: string
  tabs: readonly SlideTab[]
  active: number
  onSelect: (index: number) => void
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    let next = active
    if (e.key === "ArrowRight") next = Math.min(active + 1, tabs.length - 1)
    else if (e.key === "ArrowLeft") next = Math.max(active - 1, 0)
    else if (e.key === "Home") next = 0
    else if (e.key === "End") next = tabs.length - 1
    else return
    e.preventDefault()
    onSelect(next)
    refs.current[next]?.focus()
  }

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="fc-slide-tabs">
      {tabs.map((tab, i) => {
        const selected = active === i
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`status-tab-${tab.id}`}
            ref={el => { refs.current[i] = el }}
            aria-selected={selected}
            aria-controls={tab.controls}
            aria-label={tab.label}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(i)}
            className={`fc-slide-tab${selected ? " fc-slide-tab--on" : ""}`}
          >
            {tab.badge && !selected && <span aria-hidden="true" className={`fc-slide-tab__badge fc-slide-tab__badge--${tab.badge}`} />}
          </button>
        )
      })}
    </div>
  )
}
