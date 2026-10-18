// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { signOut } from "next-auth/react"
import QuickRecordSheet from "@/components/QuickRecordSheet"
import IconButton from "@/components/ui/IconButton"
import { MenuAction, MenuLink, MenuPanel } from "@/components/ui/Menu"
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
    <header className="fc-header">
      {fullChrome ? (
        <nav ref={menuRef} aria-label="Primary">
          <IconButton label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(v => !v)}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          </IconButton>

          {menuOpen && (
            <MenuPanel>
              <MenuLink href="/" icon="🏠" onNavigate={() => setMenuOpen(false)}>Home</MenuLink>
              <MenuLink href="/profile" icon="👤" onNavigate={() => setMenuOpen(false)}>Profile</MenuLink>
              <MenuLink href="/favourites" icon="⭐" onNavigate={() => setMenuOpen(false)}>Favourites</MenuLink>
              {showManagementLink && (
                <MenuLink href="/management" icon="⚙️" onNavigate={() => setMenuOpen(false)}>Management</MenuLink>
              )}
              {isAdminUser && (
                <MenuLink href="/admin" icon="🔐" onNavigate={() => setMenuOpen(false)}>Administration</MenuLink>
              )}
              {isAdminUser && (
                <MenuLink href="/admin/export" icon="📦" onNavigate={() => setMenuOpen(false)}>Data Export & Restore</MenuLink>
              )}
              <MenuAction
                icon="🚪"
                destructive
                onClick={() => {
                  setMenuOpen(false)
                  signOut({ callbackUrl: "/login" })
                }}
              >
                Sign out
              </MenuAction>
            </MenuPanel>
          )}
        </nav>
      ) : (
        <div className="w-9" aria-hidden="true" />
      )}

      <h1 className="fc-header__title" title={title}>
        {title}
      </h1>

      <div className="fc-header__right">
        {fullChrome && (
          <IconButton label="Quick record" aria-expanded={sheetOpen} onClick={() => setSheetOpen(v => !v)}>
            <span className="inline-flex items-center gap-1">
              <span className="text-base">⭐</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                   className={`transition-transform duration-200 ${sheetOpen ? "rotate-180" : ""}`}>
                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
          </IconButton>
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
}

export function PersonHeader({ name, photoUrl, color = "#256AA5" }: PersonHeaderProps) {
  const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
  return (
    <div className="bg-fc-blue px-4 py-1 flex items-center gap-4">
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
    </div>
  )
}
