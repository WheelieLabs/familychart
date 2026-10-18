// SPDX-License-Identifier: AGPL-3.0-only

import Link from "next/link"
import type { ReactNode } from "react"

/**
 * The grid of tiles on Management, Administration and Diagnostics: 200px minimum, 12px apart. The
 * `dense` grid (the person hub's action tiles) is 150px minimum, two across on a phone.
 */
export function HubGrid({ children, dense }: { children: ReactNode; dense?: boolean }) {
  return <div className={`fc-hub${dense ? " fc-hub--dense" : ""}`}>{children}</div>
}

interface HubTileProps {
  href: string
  /** One emoji, hidden from screen readers. */
  icon: string
  /** A place name, in Title Case. */
  title: string
  /** One line saying what is there. Left out on the person hub's action tiles. */
  description?: string
}

/** A solid Card linking to one place: icon, bold title and a one-line description. */
export function HubTile({ href, icon, title, description }: HubTileProps) {
  return (
    <Link href={href} className="fc-hub__tile" data-card="" data-surface="dark">
      <span aria-hidden="true" className="fc-hub__icon">{icon}</span>
      <span className="fc-hub__title">{title}</span>
      {description && <span className="fc-hub__description">{description}</span>}
    </Link>
  )
}

/** A tile that opens or closes a section instead of going to a page (the person hub's "More"). */
export function HubButtonTile({
  icon,
  title,
  expanded,
  controls,
  onClick,
}: {
  icon: string
  title: string
  expanded: boolean
  controls: string
  onClick: () => void
}) {
  return (
    <button type="button" className="fc-hub__tile" data-card="" data-surface="dark" aria-expanded={expanded} aria-controls={controls} onClick={onClick}>
      <span aria-hidden="true" className="fc-hub__icon">{icon}</span>
      <span className="fc-hub__title">{title}</span>
    </button>
  )
}
