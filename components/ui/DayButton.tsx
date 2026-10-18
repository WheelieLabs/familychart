// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import type { CSSProperties, ReactNode } from "react"

/**
 * One day on a calendar grid: a tappable cell whose accessible name says what is on the day (its
 * dots and lines are decorative). `outside` dims a day from the neighbouring month; `selected` marks
 * the chosen day, and is announced as pressed.
 */
export default function DayButton({
  label,
  selected,
  outside,
  onSelect,
  style,
  children,
}: {
  label: string
  selected: boolean
  outside?: boolean
  onSelect: () => void
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      onClick={onSelect}
      style={style}
      className={`fc-day${outside ? " fc-day--outside" : ""}${selected ? " fc-day--on" : ""}`}
    >
      {children}
    </button>
  )
}
