// SPDX-License-Identifier: AGPL-3.0-only

/** Target id for skip-to-content links (WCAG 2.4.1). */
export const MAIN_CONTENT_ID = "main-content"

export const mainContentTargetProps = {
  id: MAIN_CONTENT_ID,
  tabIndex: -1,
} as const
