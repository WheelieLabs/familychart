// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import type { ReactNode } from "react"

export interface Suggestion {
  key: string | number
  label: ReactNode
  onSelect: () => void
}

/**
 * The list under a text input that offers matches to pick from, each a tappable row (44px on
 * touch). Taking a row does not move focus out of the input first, so a click always lands. Place
 * it inside the same wrapper as the input so focus moving into the list does not count as leaving.
 */
export default function SuggestionList({ id, items }: { id?: string; items: readonly Suggestion[] }) {
  return (
    <ul id={id} className="fc-suggest">
      {items.map(item => (
        <li key={item.key}>
          <button type="button" className="fc-suggest__item" onMouseDown={e => e.preventDefault()} onClick={item.onSelect}>
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  )
}
