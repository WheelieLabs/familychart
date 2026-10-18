// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { favouriteRecordHref } from "@/lib/hydration/hydration-presets"
import { useState, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import Button from "@/components/ui/Button"
import IconButton from "@/components/ui/IconButton"
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

  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  // Opening moves focus into the sheet; closing returns it to what opened it (the ⭐ button).
  useEffect(() => {
    if (!open || !mounted) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.querySelector<HTMLElement>('a[href], button:not([disabled])')?.focus()
    return () => { opener?.focus() }
  }, [open, mounted])

  // Tab stays inside the open sheet.
  function trapTab(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return
    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [],
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

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
    router.push(favouriteRecordHref(fav))
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
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Quick record"
        data-surface="light"
        // Closed, the sheet is slid off screen but still in the DOM: inert keeps Tab and screen readers out.
        inert={!open}
        onKeyDown={trapTab}
        className={`fixed inset-x-0 top-0 z-[81] flex flex-col
                    transition-transform duration-300 motion-reduce:transition-none
                    ${open ? "translate-y-0" : "-translate-y-full"}`}
        style={{ maxHeight: "88dvh" }}
      >
        <div className="fc-quick" style={{ maxHeight: "88dvh" }}>
          <div className="fc-quick__head">
            <div>
              <p className="fc-quick__title">Quick record</p>
              <p className="fc-field__hint">Tap to record — you&apos;ll confirm the details</p>
            </div>
            <IconButton label="Close" onClick={onClose}>✕</IconButton>
          </div>

          <div className="fc-quick__body fc-scroll">
            {loading && <p className="fc-field__hint">Loading…</p>}

            {error && <p className="fc-field__error">Couldn&apos;t load favourites.</p>}

            {!loading && !error && favourites.length === 0 && (
              <div className="fc-form">
                <p className="fc-section-copy">
                  Favourites are shortcuts to the people and actions you use most often — like a frequent
                  PRN medication or a regular check-in.
                </p>
                <div>
                  <Button href="/favourites" onClick={onClose}>Add your first favourite</Button>
                </div>
              </div>
            )}

            {!loading && !error && favourites.map(fav => (
              <div key={fav.id} className="fc-quick__row">
                {fav.resolved ? (
                  <Button variant="secondary" fullWidth onClick={() => handleTap(fav)}>
                    <span aria-hidden="true">{fav.action_kind === "medication" ? "💊" : "📊"}</span>
                    <span>{derivedLabel(fav)}</span>
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    fullWidth
                    disabled
                    disabledReason="Unavailable — target removed or deactivated"
                  >
                    <span aria-hidden="true">{fav.action_kind === "medication" ? "💊" : "📊"}</span>
                    <span>{derivedLabel(fav)}</span>
                  </Button>
                )}
              </div>
            ))}
          </div>

          <div className="fc-quick__foot">
            <Button variant="quiet" href="/favourites" onClick={onClose}>＋ Manage favourites</Button>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}
