// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useState } from "react"
import Modal from "@/components/Modal"
import Button from "@/components/ui/Button"

interface ChangelogEntry {
  version: string
  date: string
  highlights: string[]
}

export default function WhatsNewModal() {
  const [mounted, setMounted] = useState(false)
  const [entries, setEntries] = useState<ChangelogEntry[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setMounted(true)
    void fetch("/api/whats-new")
      .then(r => r.ok ? r.json() : null)
      .then((data: { entries: ChangelogEntry[] } | null) => {
        if (data && data.entries.length > 0) {
          setEntries(data.entries)
          setOpen(true)
        }
      })
      .catch(() => {})
  }, [])

  function dismiss() {
    setOpen(false)
    void fetch("/api/whats-new/seen", { method: "POST" }).catch(() => {})
  }

  if (!mounted || !open) return null

  const multipleReleases = entries.length > 1

  return (
    <Modal
      open
      onClose={dismiss}
      title="What's new"
      backdropClassName="fixed inset-0 z-[200] flex items-end justify-center sm:items-center bg-black/60 p-4"
      panelClassName="bg-fc-panel rounded-2xl w-full max-w-md flex flex-col gap-4 p-5 shadow-xl overflow-y-auto max-h-[80dvh]"
    >
      {multipleReleases && (
        <p className="fc-field__hint">{entries.length} updates since you last opened the app</p>
      )}
      {entries.map(entry => (
        <section key={entry.version} aria-label={`Version ${entry.version}`} className="fc-form">
          {multipleReleases && (
            <h3 className="fc-block-heading fc-whatsnew__version">v{entry.version} · {entry.date}</h3>
          )}
          <ul className="fc-whatsnew__list">
            {entry.highlights.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
      <Button fullWidth onClick={dismiss}>Got it</Button>
    </Modal>
  )
}
