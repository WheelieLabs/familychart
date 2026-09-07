// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import Link from "next/link"
import { signOut } from "next-auth/react"
import BackButton from "@/components/BackButton"
import QuickRecordSheet from "@/components/QuickRecordSheet"
import { clearLegacyBiometricCredentialId } from "@/lib/webauthn-app-lock"
import { useState, useEffect, useRef } from "react"

interface AppHeaderProps {
  title: string
  /** Force logo+title only (setup wizard, app lock). Unsigned pages also use minimal chrome. */
  minimal?: boolean
}

function FamilyChartLogo() {
  const t = "translate(14,14) scale(0.70) translate(-12,-12)"
  const heartPath = "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none">
      <defs>
        <clipPath id="fc-logo-clip">
          <path d={heartPath} transform={t}/>
        </clipPath>
      </defs>
      <g transform="scale(0.83)">
        <rect x="8" y="2" width="8" height="4" rx="1" stroke="#1a5fa8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" stroke="#1a5fa8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </g>
      <g transform={t}>
        <path d={heartPath} fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
      </g>
      <g transform={t}>
        <path d={heartPath} fill="#e11d48" stroke="#e11d48" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
      </g>
      <path d="M 7.7,14 H 10.5 L 10.85,12.6 L 11.55,14 L 12.6,8.4 L 13.3,18.2 L 14.7,14 H 20.3" stroke="#dce9f7" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" fill="none" clipPath="url(#fc-logo-clip)" opacity="0.9"/>
    </svg>
  )
}

export default function AppHeader({ title, minimal = false }: AppHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [showManagementLink, setShowManagementLink] = useState(false)
  const [isAdminUser, setIsAdminUser] = useState(false)
  const menuRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (minimal) return
    let cancelled = false
    fetch("/api/me")
      .then(r => {
        if (!r.ok) return null
        return r.json() as Promise<{ role: string | null }>
      })
      .then(me => {
        if (cancelled || !me) return
        setSignedIn(true)
        setShowManagementLink(me.role === "manager" || me.role === "admin")
        setIsAdminUser(me.role === "admin")
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [minimal])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [menuOpen])

  const fullChrome = !minimal && signedIn

  return (
    <>
    <header className="bg-fc-header px-4 py-3 flex items-center justify-between shrink-0 relative sticky top-0 z-10">
      {fullChrome ? (
        <nav ref={menuRef} aria-label="Primary">
          <button onClick={() => setMenuOpen(v => !v)}
            className="p-1 rounded-lg hover:bg-black/10 active:bg-black/20 transition-colors"
            aria-label="Menu"
            aria-expanded={menuOpen}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M3 6h18M3 12h18M3 18h18" stroke="#374151" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          </button>

          {menuOpen && (
            <div className="absolute top-14 left-3 z-50 bg-white rounded-2xl shadow-2xl
                            border border-gray-200 overflow-hidden min-w-48">
              <Link href="/" onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 px-5 py-4 hover:bg-fc-panel
                           text-gray-800 font-semibold text-base border-b border-gray-100">
                <span className="text-xl">🏠</span> Home
              </Link>
              <Link href="/profile" onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 px-5 py-4 hover:bg-fc-panel
                           text-gray-800 font-semibold text-base border-b border-gray-100">
                <span className="text-xl">👤</span> Profile
              </Link>
              <Link href="/favourites" onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 px-5 py-4 hover:bg-fc-panel
                           text-gray-800 font-semibold text-base border-b border-gray-100">
                <span className="text-xl">⭐</span> Favourites
              </Link>
              {showManagementLink && (
                <Link href="/management" onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-5 py-4 hover:bg-fc-panel
                             text-gray-800 font-semibold text-base border-b border-gray-100">
                  <span className="text-xl">⚙️</span> Management
                </Link>
              )}
              {isAdminUser && (
                <Link href="/admin" onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-5 py-4 hover:bg-fc-panel
                             text-gray-800 font-semibold text-base border-b border-gray-100">
                  <span className="text-xl">🔐</span> Admin
                </Link>
              )}
              <button onClick={() => {
                setMenuOpen(false)
                // Per-account credentials stay so the same user does not re-enrol on every
                // login. Drop the legacy device-wide key so a previous enrollee cannot unlock
                // the next account on this device.
                clearLegacyBiometricCredentialId(localStorage)
                signOut({ callbackUrl: "/login" })
              }}
                className="w-full flex items-center gap-3 px-5 py-4 hover:bg-red-50
                           text-red-600 font-semibold text-base">
                <span className="text-xl">🚪</span> Sign Out
              </button>
            </div>
          )}
        </nav>
      ) : (
        <div className="w-9" aria-hidden="true" />
      )}

      <h1 className="text-2xl font-bold text-gray-800 absolute left-1/2 -translate-x-1/2">
        {title}
      </h1>

      <div className="flex items-center gap-1">
        {fullChrome && (
          <button
            type="button"
            onClick={() => setSheetOpen(v => !v)}
            aria-label="Quick record"
            aria-expanded={sheetOpen}
            className="flex items-center gap-1 px-2 py-1 rounded-lg
                       hover:bg-black/10 active:bg-black/20 transition-colors text-gray-700"
          >
            <span className="text-base">⭐</span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                 className={`transition-transform duration-200 ${sheetOpen ? "rotate-180" : ""}`}>
              <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        <FamilyChartLogo />
      </div>
    </header>
    {fullChrome && (
      <QuickRecordSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    )}
  </>
  )
}

interface PersonHeaderProps {
  name: string
  photoUrl?: string | null
  color?: string
  /** When set, shows a back chevron on the person bar (person-scoped pages only). */
  backHref?: string
}

export function PersonHeader({ name, photoUrl, color = "#256AA5", backHref }: PersonHeaderProps) {
  const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
  return (
    <div className="bg-fc-blue px-4 py-4 flex items-start gap-4">
      <div className="w-16 h-16 rounded-full border-[3px] border-fc-ring flex items-center
                      justify-center overflow-hidden shrink-0"
           style={{ backgroundColor: color }}>
        {photoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={photoUrl} alt={name} className="w-full h-full object-cover" />
          : <span className="text-white font-bold text-lg">{initials}</span>
        }
      </div>
      <span className="text-white font-bold text-2xl flex-1">{name}</span>
      {backHref && <BackButton href={backHref} className="shrink-0" />}
    </div>
  )
}
