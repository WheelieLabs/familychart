// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import type { CSSProperties } from "react"
import { useFieldContext } from "./FormField"

interface SeveritySliderProps {
  /** 1 to 5. Start at 1, so an untouched default never raises an alert. */
  value: number
  onChange: (value: number) => void
}

/**
 * A native range (1 to 5), 44px high on touch, with the numbers 1 to 5 under it, the words Mild,
 * Moderate and Severe under 1, 3 and 5, and the value shown as "n of 5". Put it in a FormField
 * labelled "Severity".
 */
export default function SeveritySlider({ value, onChange }: SeveritySliderProps) {
  const field = useFieldContext()
  return (
    <div className="fc-slider" style={{ "--fc-frac": (value - 1) / 4 } as CSSProperties}>
      <div className="fc-slider__value" aria-hidden="true">{value} of 5</div>
      <input
        type="range"
        min={1}
        max={5}
        step={1}
        value={value}
        id={field?.id}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid ? true : undefined}
        aria-valuetext={`${value} of 5`}
        onChange={event => onChange(Number(event.target.value))}
      />
      <div className="fc-slider__ticks" aria-hidden="true">
        {[1, 2, 3, 4, 5].map(n => <span key={n} style={{ "--fc-frac": (n - 1) / 4 } as CSSProperties}>{n}</span>)}
      </div>
      <div className="fc-slider__labels" aria-hidden="true">
        <span>Mild</span>
        <span>Moderate</span>
        <span>Severe</span>
      </div>
    </div>
  )
}
