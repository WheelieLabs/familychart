// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import {
  clearAppLockPendingUrl,
  clearAppLockSuppressed,
  isAppLockSuppressed,
  locationPath,
  resolveAppLockUnlockTarget,
} from "@/lib/app-lock-navigation"
import { clearLegacyBiometricCredentialId } from "@/lib/webauthn-app-lock"

/** sessionStorage key proving this tab was unlocked for the current session. */
export const FC_BIO_UNLOCK_KEY = "fc_bio_unlock_tab"

export type BioLockEvent =
  | "visibility-hidden"
  | "visibility-shown"
  | "pagehide"
  | "beforeunload"
  | "session-status-unauthenticated"
  | "explicit-unlock"

export type BioLockStorageEffect = "clear-unlock-key" | "set-unlock-key" | "none"

export type BioLockTransition = {
  locked: boolean
  effect: BioLockStorageEffect
}

/**
 * Locked until sessionStorage holds the proven-unlock marker.
 * Fail-closed: any value other than `"1"` stays locked.
 */
export function bioLockIsLockedFromUnlockKey(stored: string | null): boolean {
  return stored !== "1"
}

/**
 * Pure lock/unlock decision. Storage and DOM effects stay in the hook.
 * Suppression is re-evaluated by the caller on each event (rc.21: an expired
 * window must not skip the re-lock on the visible transition).
 */
export function nextBioLockState(input: {
  locked: boolean
  event: BioLockEvent
  suppressed: boolean
}): BioLockTransition {
  switch (input.event) {
    case "visibility-hidden":
    case "visibility-shown":
      if (input.suppressed) return { locked: input.locked, effect: "none" }
      return { locked: true, effect: "clear-unlock-key" }
    case "pagehide":
    case "beforeunload":
      return { locked: input.locked, effect: "clear-unlock-key" }
    case "session-status-unauthenticated":
      return { locked: false, effect: "clear-unlock-key" }
    case "explicit-unlock":
      return { locked: false, effect: "set-unlock-key" }
  }
}

export function readBioUnlockKey(storage: Pick<Storage, "getItem">): string | null {
  try {
    return storage.getItem(FC_BIO_UNLOCK_KEY)
  } catch {
    return null
  }
}

export function writeBioUnlockKey(storage: Pick<Storage, "setItem">): void {
  try {
    storage.setItem(FC_BIO_UNLOCK_KEY, "1")
  } catch {
    /* ignore */
  }
}

export function clearBioUnlockKey(storage: Pick<Storage, "removeItem">): void {
  try {
    storage.removeItem(FC_BIO_UNLOCK_KEY)
  } catch {
    /* ignore */
  }
}

export function applyBioLockStorageEffect(
  storage: Pick<Storage, "setItem" | "removeItem">,
  effect: BioLockStorageEffect,
): void {
  if (effect === "clear-unlock-key") clearBioUnlockKey(storage)
  else if (effect === "set-unlock-key") writeBioUnlockKey(storage)
}

export function isBioLockEligible(
  nav: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints"> | null = typeof navigator === "undefined"
    ? null
    : navigator,
): boolean {
  if (nav == null) return false
  const ua = nav.userAgent
  const ipadAsMac =
    nav.platform === "MacIntel"
    && typeof nav.maxTouchPoints === "number"
    && nav.maxTouchPoints > 1
  const isIosPhoneOrPod = /iPhone|iPod/.test(ua)
  const isIpad = /iPad/.test(ua) || ipadAsMac
  const isAndroid = /Android/i.test(ua)
  return isIosPhoneOrPod || isIpad || isAndroid
}

export function useBioLockGate(): {
  locked: boolean
  onUnlocked: () => void
  eligible: boolean
  overlayUserId: string
  sessionAuthenticated: boolean
} {
  const eligible = useMemo(() => isBioLockEligible(), [])
  const { data: session, status } = useSession()
  const [locked, setLocked] = useState(true)
  const lockedRef = useRef(true)
  const router = useRouter()

  useLayoutEffect(() => {
    if (!eligible || status !== "authenticated" || typeof window === "undefined") return
    const nextLocked = bioLockIsLockedFromUnlockKey(readBioUnlockKey(sessionStorage))
    lockedRef.current = nextLocked
    setLocked(nextLocked)
  }, [eligible, status])

  useEffect(() => {
    if (status === "loading" || status === "authenticated") return
    const next = nextBioLockState({
      locked: true,
      event: "session-status-unauthenticated",
      suppressed: false,
    })
    applyBioLockStorageEffect(sessionStorage, next.effect)
    try {
      clearLegacyBiometricCredentialId(localStorage)
    } catch {
      /* ignore */
    }
    setLocked(next.locked)
    lockedRef.current = next.locked
  }, [status])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!eligible) return

    const applyEvent = (event: BioLockEvent, suppressed: boolean): void => {
      const next = nextBioLockState({
        locked: lockedRef.current,
        event,
        suppressed,
      })
      applyBioLockStorageEffect(sessionStorage, next.effect)
      lockedRef.current = next.locked
      setLocked(next.locked)
    }

    const onVisibility = (): void => {
      const suppressed = isAppLockSuppressed(sessionStorage)
      if (document.visibilityState === "hidden") {
        applyEvent("visibility-hidden", suppressed)
      } else {
        applyEvent("visibility-shown", suppressed)
        clearAppLockSuppressed(sessionStorage)
      }
    }

    const onPageHide = (): void => {
      applyEvent("pagehide", false)
    }
    const onBeforeUnload = (): void => {
      applyEvent("beforeunload", false)
    }

    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("pagehide", onPageHide)
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("pagehide", onPageHide)
      window.removeEventListener("beforeunload", onBeforeUnload)
    }
  }, [eligible])

  const onUnlocked = useCallback(() => {
    const target = resolveAppLockUnlockTarget(
      null,
      locationPath(window.location),
    )
    const next = nextBioLockState({
      locked: true,
      event: "explicit-unlock",
      suppressed: false,
    })
    applyBioLockStorageEffect(sessionStorage, next.effect)
    clearAppLockPendingUrl(sessionStorage)
    lockedRef.current = next.locked
    setLocked(next.locked)
    router.push(target)
  }, [router])

  return {
    locked,
    onUnlocked,
    eligible,
    overlayUserId: session?.user?.id ?? "",
    sessionAuthenticated: status === "authenticated" && session != null,
  }
}
