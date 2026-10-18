// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Privacy cover (see the App lock ADR's amendment). A plain attribute on `<html>` that CSS turns
 * into an opaque panel over the whole page. It is set directly from the hide handlers, not through
 * React state, and removed only after the App lock state machine has decided on return, so the
 * previous screen is never visible for a frame before the lock overlay (or the content) shows.
 * It is not a lock: it never grants or removes access. It does not reach the Android recents preview.
 */
const COVER_ATTR = "data-fc-cover"

export function coverNow(): void {
  document.documentElement.setAttribute(COVER_ATTR, "1")
}

/** Lifts the cover two frames after the caller applied its lock decision, so any overlay is already painted. */
export function uncoverAfterDecision(): void {
  if (!document.documentElement.hasAttribute(COVER_ATTR)) return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => document.documentElement.removeAttribute(COVER_ATTR))
  })
}
