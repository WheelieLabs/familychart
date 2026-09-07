// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { SessionProvider } from "next-auth/react"
import AppLockOverlay from "@/components/AppLockOverlay"
import { useBioLockGate } from "@/lib/bio-lock-state"

function BioLockGate({ children }: { children: React.ReactNode }) {
  const { locked, onUnlocked, eligible, overlayUserId, sessionAuthenticated } = useBioLockGate()
  const showOverlay = eligible && sessionAuthenticated && locked

  return (
    <>
      {children}
      {showOverlay ? (
        <AppLockOverlay userId={overlayUserId} onUnlocked={onUnlocked} />
      ) : null}
    </>
  )
}

export default function AppLockProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={60 * 5}>
      <BioLockGate>{children}</BioLockGate>
    </SessionProvider>
  )
}
