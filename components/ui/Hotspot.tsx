// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import type { CSSProperties, ReactNode } from "react"

interface HotspotProps {
  /** The accessible name: what the area is and, for a toggle, its state. */
  label: string
  onClick: () => void
  /** Set for a toggle area (a suggestion that is boxed or not). */
  pressed?: boolean
  /** `solid` is a filled area, `outline` a dashed one. */
  look: "solid" | "outline"
  /** Position and size, as percentages of the positioned parent. */
  box: { x: number; y: number; w: number; h: number }
  /** True while a drawing gesture owns the pointer. */
  inert?: boolean
}

/**
 * A tappable area laid over an image or canvas, positioned by percentages of its parent (the boxes
 * on a report page in the redaction check). It is a real button, so it can be reached by keyboard
 * and named; it has no text of its own.
 */
export default function Hotspot({ label, onClick, pressed, look, box, inert }: HotspotProps) {
  const style: CSSProperties = {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.w * 100}%`,
    height: `${box.h * 100}%`,
    pointerEvents: inert ? "none" : "auto",
  }
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={`fc-hotspot fc-hotspot--${look}`}
      style={style}
    />
  )
}

/** Wraps non-text content (an image or canvas) as one tappable, named control. */
export function ImageButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="fc-image-btn">
      {children}
    </button>
  )
}
