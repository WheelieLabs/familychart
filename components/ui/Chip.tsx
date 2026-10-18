// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react"

type ChipBase = {
  children: ReactNode
  disabled?: boolean
}

export type ChipProps =
  /** Pick one of several: used inside {@link ChipGroup}, which sets `checked` and the roving focus. */
  | (ChipBase & { kind: "choice"; checked: boolean; onSelect: () => void; tabIndex?: number })
  /** Pick any: a button with `aria-pressed`. */
  | (ChipBase & { kind: "toggle"; pressed: boolean; onPressedChange: (pressed: boolean) => void })
  /** Opens or closes a section: a button with `aria-expanded`, an emoji and a chevron. */
  | (ChipBase & { kind: "disclosure"; expanded: boolean; onExpandedChange: (expanded: boolean) => void; emoji?: string })

/**
 * The single chip. Selection is shown by a tick as well as a fill, so it never relies on colour.
 * Colours follow the Surface. The pill is 32px high; on touch the tap target grows to 44px.
 */
export default function Chip(props: ChipProps) {
  if (props.kind === "choice") {
    return (
      <button
        type="button"
        role="radio"
        aria-checked={props.checked}
        tabIndex={props.tabIndex}
        disabled={props.disabled}
        className="fc-chip"
        onClick={props.onSelect}
      >
        {props.checked && <span aria-hidden="true" className="fc-chip__tick">✓</span>}
        {props.children}
      </button>
    )
  }
  if (props.kind === "toggle") {
    return (
      <button
        type="button"
        aria-pressed={props.pressed}
        disabled={props.disabled}
        className="fc-chip"
        onClick={() => props.onPressedChange(!props.pressed)}
      >
        {props.pressed && <span aria-hidden="true" className="fc-chip__tick">✓</span>}
        {props.children}
      </button>
    )
  }
  return (
    <button
      type="button"
      aria-expanded={props.expanded}
      disabled={props.disabled}
      className="fc-chip"
      onClick={() => props.onExpandedChange(!props.expanded)}
    >
      {props.emoji && <span aria-hidden="true">{props.emoji}</span>}
      {props.children}
      <span aria-hidden="true" className="fc-chip__chevron">{props.expanded ? "▴" : "▾"}</span>
    </button>
  )
}

export interface ChipOption<T extends string> {
  value: T
  label: ReactNode
}

interface ChipGroupProps<T extends string> {
  /** Names the group. */
  legend: string
  /** Keeps the legend for screen readers only. */
  hideLegend?: boolean
  options: readonly ChipOption<T>[]
  value: T
  onChange: (value: T) => void
}

/**
 * Pick-one chips: a `radiogroup` of `radio` chips in a labelled `fieldset`. Only the selected chip
 * is in the tab order; the arrow keys move the selection (Home and End jump to the ends).
 */
export function ChipGroup<T extends string>({ legend, hideLegend, options, value, onChange }: ChipGroupProps<T>) {
  const legendId = useId()
  const refs = useRef<(HTMLDivElement | null)[]>([])
  const selected = Math.max(0, options.findIndex(o => o.value === value))

  function move(to: number) {
    const next = (to + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.querySelector<HTMLElement>('[role="radio"]')?.focus()
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") move(selected + 1)
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(selected - 1)
    else if (event.key === "Home") move(0)
    else if (event.key === "End") move(options.length - 1)
    else return
    event.preventDefault()
  }

  return (
    <fieldset className="fc-chip-set">
      <legend id={legendId} className={hideLegend ? "fc-visually-hidden" : "fc-chip-set__legend"}>{legend}</legend>
      <div role="radiogroup" aria-labelledby={legendId} className="fc-chip-set__chips" onKeyDown={onKeyDown}>
        {options.map((option, i) => (
          <div key={option.value} ref={el => { refs.current[i] = el }} style={{ display: "contents" }}>
            <Chip
              kind="choice"
              checked={option.value === value}
              tabIndex={i === selected ? 0 : -1}
              onSelect={() => onChange(option.value)}
            >
              {option.label}
            </Chip>
          </div>
        ))}
      </div>
    </fieldset>
  )
}
