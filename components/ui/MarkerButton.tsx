// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import type { ReactNode } from "react"

/**
 * A point on a chart or timeline that can be tapped: a 30px target centred on `x` (pixels from the
 * left of the track) with the visible shape inside. It is a real button with an accessible name and
 * `aria-pressed`, so it can be reached by keyboard.
 */
export default function MarkerButton({
  label,
  x,
  selected,
  onSelect,
  feedRowId,
  children,
}: {
  label: string
  x: number
  selected: boolean
  onSelect: () => void
  /** Lets the page scroll a marker into view by the history row it stands for. */
  feedRowId?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="fc-marker"
      style={{ left: x }}
      aria-label={label}
      aria-pressed={selected}
      onClick={onSelect}
      data-timeline-feed-row-id={feedRowId}
    >
      {children}
    </button>
  )
}
