// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useState } from "react"
import { subscribeToAnnouncements } from "@/lib/announce"

/**
 * The app-wide live region, mounted once in the root layout. Polite announcements (saved, file
 * chosen, pending result) go to a `status` region; assertive ones (a failed submit) go to an
 * `alert` region. Both are visually hidden. Components speak through `announce()` in `lib/announce`.
 */
export default function LiveRegion() {
  const [polite, setPolite] = useState("")
  const [assertive, setAssertive] = useState("")

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const unsubscribe = subscribeToAnnouncements((message, politeness) => {
      const set = politeness === "assertive" ? setAssertive : setPolite
      // Clear first so announcing the same text twice is still announced.
      set("")
      const timer = setTimeout(() => {
        timers.delete(timer)
        set(message)
      }, 50)
      timers.add(timer)
    })
    return () => {
      unsubscribe()
      timers.forEach(clearTimeout)
    }
  }, [])

  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" className="fc-visually-hidden" data-live-region="polite">
        {polite}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className="fc-visually-hidden" data-live-region="assertive">
        {assertive}
      </div>
    </>
  )
}
