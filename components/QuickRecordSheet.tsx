// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { FavouriteResolved } from "@/lib/domain-types"

interface QuickRecordSheetProps {
  open: boolean
  onClose: () => void
}

function personInitials(name: string): string {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
}

function derivedLabel(fav: FavouriteResolved): string {
  if (fav.label) return fav.label
  const p = fav.person_name ?? "Unknown"
  const a = fav.action_kind === "medication"
    ? (fav.medication_name ?? "Unknown medication")
    : (fav.observation_type ?? "Unknown observation")
  return `${p} · ${a}`
}

export default function QuickRecordSheet({ open, onClose }: QuickRecordSheetProps) {
  const [mounted, setMounted] = useState(false)
  const [favourites, setFavourites] = useState<FavouriteResolved[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const router = useRouter()

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(false)
    fetch("/api/favourites")
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setFavourites)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  function handleTap(fav: FavouriteResolved) {
    if (!fav.resolved) return
    onClose()
    if (fav.action_kind === "medication") {
      const params = new URLSearchParams({ medication_id: String(fav.medication_id) })
      if (fav.default_value) params.set("dosage", fav.default_value)
      router.push(`/${fav.person_id}/record-medication?${params}`)
    } else {
      router.push(`/${fav.person_id}/record-observation?type=${encodeURIComponent(fav.observation_type!)}`)
    }
  }

  if (!mounted) return null

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[80] bg-black/50 transition-opacity duration-300
                    motion-reduce:transition-none
                    ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Sheet panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick record"
        className={`fixed inset-x-0 top-0 z-[81] flex flex-col
                    transition-transform duration-300 motion-reduce:transition-none
                    ${open ? "translate-y-0" : "-translate-y-full"}`}
        style={{ maxHeight: "88dvh" }}
      >
        <div className="bg-white rounded-b-2xl shadow-xl flex flex-col overflow-hidden" style={{ maxHeight: "88dvh" }}>

          {/* Grab handle */}
          <div className="flex justify-center pt-2 pb-1 shrink-0">
            <div className="w-10 h-1 rounded-full bg-gray-300" />
          </div>

          {/* Header row */}
          <div className="flex items-start justify-between px-4 py-3 border-b border-gray-100 shrink-0">
            <div>
              <p className="font-bold text-gray-800 text-base">Quick record</p>
              <p className="text-xs text-gray-500 mt-0.5">Tap to record — you&apos;ll confirm the details</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              className="p-1 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors shrink-0 ml-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          {/* Scrollable favourite cards */}
          <div className="overflow-y-auto fc-scroll flex-1 px-3 py-3 flex flex-col gap-2">
            {loading && <p className="text-sm text-gray-500 px-1">Loading…</p>}

            {error && <p className="text-sm text-red-600 px-1">Couldn&apos;t load favourites.</p>}

            {!loading && !error && favourites.length === 0 && (
              <div className="flex flex-col gap-3 px-1 py-2">
                <p className="text-sm text-gray-600 leading-relaxed">
                  Favourites are shortcuts to the people and actions you use most often — like a frequent
                  PRN medication or a regular check-in.
                </p>
                <Link href="/favourites" onClick={onClose}
                  className="self-start bg-fc-blue text-white font-bold px-4 py-2 rounded-lg text-sm
                             hover:bg-fc-blue-mid active:bg-fc-blue-dark transition-colors">
                  Add your first favourite
                </Link>
              </div>
            )}

            {!loading && !error && favourites.map(fav => (
              <button
                key={fav.id}
                type="button"
                disabled={!fav.resolved}
                onClick={() => handleTap(fav)}
                className={`w-full text-left flex items-center gap-3 rounded-xl px-3 py-2.5
                            border-l-4 transition-colors
                            ${fav.action_kind === "medication" ? "border-amber-400" : "border-cyan-400"}
                            ${fav.resolved
                              ? "bg-gray-100 hover:bg-gray-200 active:bg-gray-300 cursor-pointer"
                              : "bg-gray-100 opacity-60 cursor-not-allowed"}`}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden"
                  style={{ backgroundColor: fav.person_color ?? "#256AA5" }}
                >
                  <span className="text-white font-bold text-xs">{personInitials(fav.person_name ?? "?")}</span>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{derivedLabel(fav)}</p>
                  {!fav.resolved && (
                    <p className="text-xs text-amber-700 mt-0.5">Unavailable — target removed or deactivated</p>
                  )}
                </div>

                {fav.resolved && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-gray-400 shrink-0">
                    <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                )}
              </button>
            ))}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-100 px-4 py-3 shrink-0">
            <Link href="/favourites" onClick={onClose}
              className="text-sm font-semibold text-fc-blue hover:text-fc-blue-mid transition-colors">
              ＋ Manage favourites
            </Link>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}
