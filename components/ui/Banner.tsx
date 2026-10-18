// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, type ReactNode } from "react"
import { announce } from "@/lib/announce"
import IconButton from "./IconButton"
import Surface from "./Surface"

export type BannerKind = "info" | "warning" | "error" | "success"

const KINDS: Record<BannerKind, { icon: string; lead: string }> = {
  info: { icon: "ℹ️", lead: "Note" },
  warning: { icon: "⚠️", lead: "Warning" },
  error: { icon: "⛔", lead: "Error" },
  success: { icon: "✅", lead: "Success" },
}

interface BannerProps {
  kind: BannerKind
  /** The bold lead word. Defaults to the kind's word, so meaning never relies on colour. */
  lead?: string
  /**
   * True when the banner appears after an action (a save, a failed sign-in). It is then announced
   * through the live region. A banner already present at load is plain content. An error banner
   * uses `role="alert"`, which announces it assertively on its own.
   */
  announced?: boolean
  /** Adds a Dismiss button. */
  onDismiss?: () => void
  children: ReactNode
}

/**
 * The light container for notices, in four kinds, each with an icon, a bold lead word and the text.
 * It declares a light Surface, so any button inside takes its light colours.
 */
export default function Banner({ kind, lead, announced, onDismiss, children }: BannerProps) {
  const { icon, lead: defaultLead } = KINDS[kind]
  const leadWord = lead ?? defaultLead

  // Only text can be spoken through the live region; a banner with a link is read in place.
  const spoken = typeof children === "string" ? children : null
  useEffect(() => {
    if (announced && kind !== "error" && spoken) announce(`${leadWord}: ${spoken}`, "polite")
  }, [announced, kind, leadWord, spoken])

  return (
    <Surface
      kind="light"
      className={`fc-banner fc-banner--${kind}`}
      role={kind === "error" ? "alert" : undefined}
    >
      <span aria-hidden="true" className="fc-banner__icon">{icon}</span>
      <p className="fc-banner__body" style={{ margin: 0 }}>
        <span className="fc-banner__lead">{leadWord}:</span> {children}
      </p>
      {onDismiss && (
        <span className="fc-banner__dismiss">
          <IconButton label="Dismiss" onClick={onDismiss}>✕</IconButton>
        </span>
      )}
    </Surface>
  )
}
