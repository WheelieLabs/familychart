// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useState } from "react"

/**
 * Renders "· Demo {version}" next to the app version in the footer, but only
 * when the running instance is in demo mode — /api/version omits demoVersion
 * entirely for self-host/managed, so this renders nothing there.
 */
export default function DemoVersionBadge() {
  const [demoVersion, setDemoVersion] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/version", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { demoVersion?: string } | null) => {
        if (!cancelled && data?.demoVersion) setDemoVersion(data.demoVersion)
      })
      .catch(() => {
        // Offline or transient error — badge just stays hidden.
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!demoVersion) return null

  return (
    <>
      <span aria-hidden="true">·</span>
      <span>Demo {demoVersion}</span>
    </>
  )
}
