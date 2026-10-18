// SPDX-License-Identifier: AGPL-3.0-only

import Link from "next/link"
import { Fragment, type ReactNode } from "react"

/** Offers line breaks after "@" and "." in an email-like title, so it wraps at a part, not mid-word. */
function breakableTitle(title: string): ReactNode {
  if (!title.includes("@") || /\s/.test(title)) return title
  let offset = 0
  return title.split(/(?<=[@.])/).map(part => {
    const start = offset
    offset += part.length
    return <Fragment key={start}>{start > 0 && <wbr />}{part}</Fragment>
  })
}

interface ListCardProps {
  /** The row's name. Wraps; it is never cut off. */
  title: string
  /** Makes the title a link. Its accessible name is the visible title. */
  href?: string
  /** One emoji, 28px, hidden from screen readers. */
  icon?: string
  /** A 40px photo or initials, hidden from screen readers. */
  avatar?: { src?: string | null; name: string }
  /** The detail line, joined with " · ". Put the time first so a day's doses read in order. */
  meta?: readonly (string | null | undefined | false)[]
  /** Free text such as a comment: last on the meta line, in italics. */
  note?: string | null
  /** A line for links (44px targets) and badges. */
  extras?: ReactNode
  /** Vertically centred at the end: `EntityRowActions`, or a named `Toggle`. */
  trailing?: ReactNode
  /** The same Card dimmed through the disabled tokens (an inactive catalogue row). */
  inactive?: boolean
  /** Runs when the title link is followed (e.g. to note that the list opened the record). */
  onOpen?: () => void
  /** Identifies the row so a page can scroll to it (`data-feed-row-id`). */
  rowId?: string
  /** Rings the row briefly, e.g. one reached from "View on timeline". */
  highlighted?: boolean
  /** A red left edge for a row that records something that did not happen (a Missed dose). Pair it with a badge in `extras`. */
  missed?: boolean
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** The `ul` that spaces cards 12px apart. Its children are `ListCard`s. */
export function CardList({ children }: { children: ReactNode }) {
  return <ul className="fc-card-list">{children}</ul>
}

/**
 * The one list row for History, People, Medications, Observation Types, Accounts and the schedule
 * lists: a solid Card with a leading icon or avatar, a wrapping bold title, a muted meta line,
 * optional links and badges, and the actions at the end.
 */
export default function ListCard({
  title,
  href,
  icon,
  avatar,
  meta = [],
  note,
  extras,
  trailing,
  inactive,
  onOpen,
  rowId,
  highlighted,
  missed,
}: ListCardProps) {
  const parts = meta.filter((part): part is string => !!part)
  return (
    <li
      className={`fc-card${inactive ? " fc-card--inactive" : ""}${highlighted ? " fc-card--highlight" : ""}${missed ? " fc-card--missed" : ""}`}
      data-feed-row-id={rowId}
      data-card=""
      data-surface="dark"
    >
      {icon && <span aria-hidden="true" className="fc-card__icon">{icon}</span>}
      {avatar && (
        <span aria-hidden="true" className="fc-card__avatar">
          {avatar.src ? (
            // eslint-disable-next-line @next/next/no-img-element -- a small decorative photo from the app's own uploads
            <img src={avatar.src} alt="" />
          ) : (
            initials(avatar.name)
          )}
        </span>
      )}
      <div className="fc-card__body">
        <div className="fc-card__title">
          {href ? <Link href={href} className="fc-card__link" onClick={onOpen}>{breakableTitle(title)}</Link> : breakableTitle(title)}
        </div>
        {(parts.length > 0 || note) && (
          <div className="fc-card__meta">
            {parts.join(" · ")}
            {note && (
              <>
                {parts.length > 0 && " · "}
                <em>{note}</em>
              </>
            )}
          </div>
        )}
        {extras && <div className="fc-card__extras">{extras}</div>}
      </div>
      {trailing && <div className="fc-card__trailing">{trailing}</div>}
    </li>
  )
}
