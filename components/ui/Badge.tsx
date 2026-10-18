// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react"

export type BadgeTone = "warning" | "success" | "neutral" | "info" | "error"

/**
 * A self-contained pill: solid fill and dark text, never transparent, so it reads on any surface.
 * Tones: warning (Moderate), success (Active), neutral (Inactive), info, error.
 */
export default function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`fc-badge fc-badge--${tone}`}>{children}</span>
}
