// SPDX-License-Identifier: AGPL-3.0-only

import Button from "./Button"
import type { Crumb } from "@/lib/ui/breadcrumbs"

/**
 * The trail up the app's structure: every level above this page as a link, then this page as plain
 * text (`aria-current`). It goes up one level in the structure, never back in browser history. The
 * nearest parent carries a "‹". Each link's accessible name is its visible text.
 */
export default function Breadcrumb({ trail }: { trail: readonly Crumb[] }) {
  if (trail.length === 0) return null
  const parentIndex = trail.length - 2
  return (
    <nav aria-label="Breadcrumb" className="fc-crumbs">
      <ol>
        {trail.map((crumb, i) => {
          const isCurrent = i === trail.length - 1
          return (
            <li key={crumb.label}>
              {isCurrent ? (
                <span aria-current="page">{crumb.label}</span>
              ) : (
                <Button variant="quiet" href={crumb.href} onClick={crumb.onClick}>
                  {i === parentIndex && <span aria-hidden="true">‹ </span>}
                  {crumb.label}
                </Button>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
