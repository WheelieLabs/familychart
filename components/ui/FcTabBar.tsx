// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useRef, type KeyboardEvent } from "react"

export interface FcTabItem<T extends string = string> {
  value: T
  label: string
}

/**
 * The tab strip under the header (History, Files, Medications, Schedules and Goals, Profile). One
 * tab stop: the selected tab; arrow keys (and Home and End) move between tabs. Tabs are not buttons.
 */
export function FcTabBar<T extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: readonly FcTabItem<T>[]
  active: T
  onSelect: (value: T) => void
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex(t => t.value === active)
    let next = index
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === "Home") next = 0
    else if (event.key === "End") next = tabs.length - 1
    else return
    event.preventDefault()
    onSelect(tabs[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div className="fc-tabs" role="tablist" data-surface="dark" onKeyDown={onKeyDown}>
      {tabs.map(({ value, label }, i) => (
        <button
          key={value}
          ref={el => { refs.current[i] = el }}
          type="button"
          role="tab"
          aria-selected={active === value}
          tabIndex={active === value ? 0 : -1}
          onClick={() => onSelect(value)}
          className="fc-tab"
        >
          {label}
        </button>
      ))}
    </div>
  )
}
