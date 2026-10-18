// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Announcements for screen readers. Components call `announce()`; the app-wide live region (mounted
 * once in the root layout) subscribes and renders the text. With no region mounted the call does
 * nothing, so shared components can announce without depending on the layout.
 */
export type Politeness = "polite" | "assertive"

type Listener = (message: string, politeness: Politeness) => void

const listeners = new Set<Listener>()

export function announce(message: string, politeness: Politeness = "polite"): void {
  for (const listener of listeners) listener(message, politeness)
}

/** Subscribe to announcements. Returns the unsubscribe function. */
export function subscribeToAnnouncements(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
