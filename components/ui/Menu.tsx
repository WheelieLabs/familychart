// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import Link from "next/link"
import type { ReactNode } from "react"

/** The list of destinations in the header menu: a light panel with one 44px row per item. */
export function MenuPanel({ children }: { children: ReactNode }) {
  return <ul className="fc-menu" data-surface="light">{children}</ul>
}

/** A destination in the menu: an emoji (hidden from screen readers) and its name. */
export function MenuLink({
  href,
  icon,
  onNavigate,
  children,
}: {
  href: string
  icon: string
  onNavigate?: () => void
  children: ReactNode
}) {
  return (
    <li>
      <Link href={href} className="fc-menu__item" onClick={onNavigate}>
        <span aria-hidden="true" className="fc-menu__icon">{icon}</span>
        {children}
      </Link>
    </li>
  )
}

/** An action in the menu (Sign out): looks like a row, in the destructive colour. */
export function MenuAction({
  icon,
  onClick,
  destructive,
  children,
}: {
  icon: string
  onClick: () => void
  destructive?: boolean
  children: ReactNode
}) {
  return (
    <li>
      <button type="button" className={`fc-menu__item${destructive ? " fc-menu__item--destructive" : ""}`} onClick={onClick}>
        <span aria-hidden="true" className="fc-menu__icon">{icon}</span>
        {children}
      </button>
    </li>
  )
}
