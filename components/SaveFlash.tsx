// SPDX-License-Identifier: AGPL-3.0-only
"use client"

import { useEffect, useState } from "react"
import Banner from "@/components/ui/Banner"
import { takeSaveFlash } from "@/lib/ui/save-flash"

/**
 * The "Saved: Weight 32.1 kg" banner on the person hub after a record is saved. It stays until it is
 * dismissed or the person navigates on, and is announced politely.
 */
export default function SaveFlash({ className = "" }: { className?: string }) {
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const flash = takeSaveFlash()
    if (flash !== null) setMessage(flash)
  }, [])

  if (message === null) return null
  return (
    <div className={className}>
      <Banner kind="success" lead="Saved" announced onDismiss={() => setMessage(null)}>{message}</Banner>
    </div>
  )
}
