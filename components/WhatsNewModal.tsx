// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"

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

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center sm:items-center bg-black/60 p-4"
      role="presentation"
      onClick={dismiss}
    >
      <div
        className="bg-fc-panel rounded-2xl w-full max-w-md flex flex-col gap-0 shadow-xl overflow-hidden max-h-[80dvh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 border-b border-gray-200/60">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="whats-new-title" className="font-bold text-gray-800 text-lg leading-tight">
                What&apos;s new
              </h2>
              {multipleReleases && (
                <p className="text-gray-500 text-xs mt-0.5">
                  {entries.length} updates since you last opened the app
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Close"
              className="text-gray-400 hover:text-gray-600 transition-colors mt-0.5 shrink-0"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-4 flex flex-col gap-5">
          {entries.map((entry, i) => (
            <div key={entry.version} className={i > 0 ? "border-t border-gray-200/60 pt-4" : ""}>
              {multipleReleases && (
                <p className="text-xs font-semibold text-fc-blue uppercase tracking-wide mb-2">
                  v{entry.version} · {entry.date}
                </p>
              )}
              <ul className="flex flex-col gap-2">
                {entry.highlights.map((item, j) => (
                  <li key={j} className="flex gap-2.5 text-sm text-gray-700 leading-snug">
                    <span className="mt-1 shrink-0 w-1.5 h-1.5 rounded-full bg-fc-blue" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="px-5 pb-5 pt-3 border-t border-gray-200/60">
          <button
            type="button"
            onClick={dismiss}
            className="w-full bg-fc-blue hover:bg-fc-blue-mid text-white font-bold rounded-xl py-3 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
