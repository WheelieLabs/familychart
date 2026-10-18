// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react"

/**
 * One icon per situation, so the same situation always gets the same icon. Migration tickets add a
 * row here when a screen's empty state is not yet listed.
 */
export const EMPTY_STATE_ICONS = {
  noPeople: "👨‍👩‍👧",
  noMedications: "💊",
  noRecords: "📋",
  noObservations: "📊",
  noSymptoms: "🤒",
  noTestResults: "🧪",
  noObservationTypes: "📏",
  noSchedules: "🗓️",
  noAccounts: "👥",
  noFavourites: "⭐",
  noAuditEntries: "🧾",
  noFiles: "📁",
  noSessions: "🔑",
  accessDenied: "🔒",
  pageNotFound: "🔍",
  invalidLink: "🔗",
  error: "⚠️",
  desktopRequired: "🖥️",
} as const

export type EmptyStateIcon = (typeof EMPTY_STATE_ICONS)[keyof typeof EMPTY_STATE_ICONS]

interface EmptyStateProps {
  /** One emoji from {@link EMPTY_STATE_ICONS}. Hidden from screen readers. */
  icon: EmptyStateIcon
  /** What is missing, in sentence case. A real `h2`. */
  heading: string
  /** What to do next, in a sentence or two. */
  children: ReactNode
  /** A primary Default `Button`, only when the person can act. */
  action?: ReactNode
}

/**
 * An empty screen or dead end: centred in the space left on the canvas, with no card, so it never
 * looks broken. Say what is missing and what to do next.
 */
export default function EmptyState({ icon, heading, children, action }: EmptyStateProps) {
  return (
    <div className="fc-empty">
      <span aria-hidden="true" className="fc-empty__icon">{icon}</span>
      <h2 className="fc-empty__heading">{heading}</h2>
      <p className="fc-empty__copy">{children}</p>
      {action && <div className="fc-empty__action">{action}</div>}
    </div>
  )
}
