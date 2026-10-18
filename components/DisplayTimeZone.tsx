// SPDX-License-Identifier: AGPL-3.0-only
"use client"

import { useEffect } from "react"
import { setDisplayTimeZone } from "@/lib/display-time-zone"

/** Loads the instance timezone once so every date shown or typed on this device uses the household's zone. */
export default function DisplayTimeZone() {
  useEffect(() => {
    let cancelled = false
    fetch("/api/me")
      .then(r => (r.ok ? (r.json() as Promise<{ instanceTimezone?: string }>) : null))
      .then(me => {
        if (cancelled || typeof me?.instanceTimezone !== "string" || me.instanceTimezone.trim() === "") return
        setDisplayTimeZone(me.instanceTimezone)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  return null
}
