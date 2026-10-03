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
  clearAppLockLeftAt,
  clearAppLockPendingUrl,
  clearAppLockSuppressed,
  locationPath,
  readAppLockElapsedSinceLeftMs,
  resolveAppLockUnlockTarget,
  writeAppLockLeftAt,
  isAppLockSuppressed,
} from "@/lib/app-lock-navigation"
import { clearLegacyBiometricCredentialId } from "@/lib/webauthn-app-lock"

/** sessionStorage key proving this tab was unlocked for the current session. */
export const FC_BIO_UNLOCK_KEY = "fc_bio_unlock_tab"

export type BioLockEvent =
  | "left"
  | "returned"
  | "fresh-start"
  | "in-app-navigation"
  | "session-unconfirmed"
  | "session-confirmed-signed-out"
  | "explicit-unlock"
  | "settings-changed"

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
 * Pure lock/unlock decision (ADR-0016's App lock state machine). Storage and
 * DOM effects stay in the hook.
 *
 * - `fresh-start` always locks: a cold start or reload must never trust anything persisted
 *   from before it (story 24) — the hook never seeds `locked` from storage on mount.
 * - `session-unconfirmed` fails closed: once the Account has been authenticated in this
 *   page, a transient/unconfirmed session check (offline, server restart, a 5xx) can never
 *   unlock it (stories 14-15). Before that first authentication it's a no-op.
 * - `session-confirmed-signed-out` is the one case that does unlock — there's no session
 *   left to protect; the caller redirects to login.
 * - `returned` only re-locks once the suppression window (photo/camera pickers, capped at
 *   2 minutes — see lib/app-lock-navigation.ts) and the grace period have both lapsed.
 * - `in-app-navigation` and `settings-changed` never change the lock state by themselves.
 */
export function nextBioLockState(input: {
  locked: boolean
  event: BioLockEvent
  suppressed: boolean
  hasAuthenticatedThisPage: boolean
  graceMs: number
  elapsedSinceLeftMs: number | null
}): BioLockTransition {
  switch (input.event) {
    case "left":
      return { locked: input.locked, effect: "none" }
    case "returned":
      if (input.suppressed) return { locked: input.locked, effect: "none" }
      if (input.elapsedSinceLeftMs != null && input.elapsedSinceLeftMs <= input.graceMs) {
        return { locked: input.locked, effect: "none" }
      }
      return { locked: true, effect: "clear-unlock-key" }
    case "fresh-start":
      return { locked: true, effect: "clear-unlock-key" }
    case "in-app-navigation":
      return { locked: input.locked, effect: "none" }
    case "session-unconfirmed":
      if (input.hasAuthenticatedThisPage) return { locked: true, effect: "clear-unlock-key" }
      return { locked: input.locked, effect: "none" }
    case "session-confirmed-signed-out":
      return { locked: false, effect: "clear-unlock-key" }
    case "explicit-unlock":
      return { locked: false, effect: "set-unlock-key" }
    case "settings-changed":
      return { locked: input.locked, effect: "none" }
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

/** Per-device opt-out key. Device-local by design: a broken authenticator on
 * one device shouldn't disable app-lock on the account's other devices. */
const APP_LOCK_DISABLED_KEY = "familychart_app_lock_disabled"

function appLockDisabledStorageKey(userId: string): string {
  return `${APP_LOCK_DISABLED_KEY}:${encodeURIComponent(userId)}`
}

export function isAppLockDisabled(
  storage: Pick<Storage, "getItem">,
  userId: string,
): boolean {
  const id = userId.trim()
  if (!id) return false
  try {
    return storage.getItem(appLockDisabledStorageKey(id)) === "1"
  } catch {
    return false
  }
}

export function setAppLockDisabled(
  storage: Pick<Storage, "setItem" | "removeItem">,
  userId: string,
  disabled: boolean,
): void {
  const id = userId.trim()
  if (!id) return
  try {
    if (disabled) storage.setItem(appLockDisabledStorageKey(id), "1")
    else storage.removeItem(appLockDisabledStorageKey(id))
  } catch {
    /* ignore */
  }
}

/** The App lock grace period (CONTEXT.md): device-local, per Account. Default "immediate". */
export type AppLockGracePeriod = "immediate" | "30s" | "1m" | "5m"

export const APP_LOCK_GRACE_PERIOD_MS: Record<AppLockGracePeriod, number> = {
  immediate: 0,
  "30s": 30_000,
  "1m": 60_000,
  "5m": 5 * 60_000,
}

const APP_LOCK_GRACE_KEY = "familychart_app_lock_grace"

function appLockGraceStorageKey(userId: string): string {
  return `${APP_LOCK_GRACE_KEY}:${encodeURIComponent(userId)}`
}

function isAppLockGracePeriod(value: string): value is AppLockGracePeriod {
  return Object.hasOwn(APP_LOCK_GRACE_PERIOD_MS, value)
}

export function getAppLockGracePeriod(
  storage: Pick<Storage, "getItem">,
  userId: string,
): AppLockGracePeriod {
  const id = userId.trim()
  if (!id) return "immediate"
  try {
    const raw = storage.getItem(appLockGraceStorageKey(id))
    return raw != null && isAppLockGracePeriod(raw) ? raw : "immediate"
  } catch {
    return "immediate"
  }
}

export function setAppLockGracePeriod(
  storage: Pick<Storage, "setItem" | "removeItem">,
  userId: string,
  period: AppLockGracePeriod,
): void {
  const id = userId.trim()
  if (!id) return
  try {
    if (period === "immediate") storage.removeItem(appLockGraceStorageKey(id))
    else storage.setItem(appLockGraceStorageKey(id), period)
  } catch {
    /* ignore */
  }
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
  disableAppLock: () => void
  eligible: boolean
  overlayUserId: string
  sessionAuthenticated: boolean
} {
  const deviceCapable = useMemo(() => isBioLockEligible(), [])
  const { data: session, status } = useSession()
  const userId = session?.user?.id ?? ""
  const [optedOut, setOptedOut] = useState(false)
  const [graceMs, setGraceMs] = useState(0)
  const eligible = deviceCapable && !optedOut
  // Fresh start (cold start or reload) always locks — never seeded from persisted storage.
  // See nextBioLockState's "fresh-start" case.
  const [locked, setLocked] = useState(true)
  const lockedRef = useRef(true)
  const hasAuthenticatedRef = useRef(false)
  const router = useRouter()

  // Device-local opt-out and grace period (lib/bio-lock-state.ts's isAppLockDisabled /
  // getAppLockGracePeriod): lets a user whose device can't reliably complete WebAuthn
  // escape a permanent lockout without weakening app-lock on their other, working devices.
  const readDeviceSettings = useCallback((): void => {
    if (!userId || typeof window === "undefined") return
    setOptedOut(isAppLockDisabled(localStorage, userId))
    setGraceMs(APP_LOCK_GRACE_PERIOD_MS[getAppLockGracePeriod(localStorage, userId)])
  }, [userId])

  useLayoutEffect(() => {
    readDeviceSettings()
  }, [readDeviceSettings])

  // Settings changes apply live, including across tabs on this device ("my
  // App lock settings to take effect immediately... in every tab on this device").
  useEffect(() => {
    if (typeof window === "undefined") return
    const onStorage = (e: StorageEvent): void => {
      if (e.key != null && !e.key.startsWith(APP_LOCK_DISABLED_KEY) && !e.key.startsWith(APP_LOCK_GRACE_KEY)) {
        return
      }
      readDeviceSettings()
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [readDeviceSettings])

  // Fresh start: fires once, the first time this mount resolves an authenticated session.
  // Deliberately never reads any prior unlock state from storage.
  useLayoutEffect(() => {
    if (!eligible || status !== "authenticated" || typeof window === "undefined") return
    const next = nextBioLockState({
      locked: true,
      event: "fresh-start",
      suppressed: false,
      hasAuthenticatedThisPage: false,
      graceMs: 0,
      elapsedSinceLeftMs: null,
    })
    applyBioLockStorageEffect(sessionStorage, next.effect)
    lockedRef.current = next.locked
    hasAuthenticatedRef.current = true
    setLocked(next.locked)
  }, [eligible, status])

  useEffect(() => {
    if (status === "loading") return
    const event = status === "authenticated" ? "session-unconfirmed" : "session-confirmed-signed-out"
    const next = nextBioLockState({
      locked: lockedRef.current,
      event,
      suppressed: false,
      hasAuthenticatedThisPage: hasAuthenticatedRef.current,
      graceMs: 0,
      elapsedSinceLeftMs: null,
    })
    applyBioLockStorageEffect(sessionStorage, next.effect)
    if (event === "session-confirmed-signed-out") {
      try {
        clearLegacyBiometricCredentialId(localStorage)
      } catch {
        /* ignore */
      }
    }
    setLocked(next.locked)
    lockedRef.current = next.locked
  }, [status])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!eligible) return

    const applyEvent = (
      event: BioLockEvent,
      opts: { suppressed?: boolean; elapsedSinceLeftMs?: number | null } = {},
    ): void => {
      const next = nextBioLockState({
        locked: lockedRef.current,
        event,
        suppressed: opts.suppressed ?? false,
        hasAuthenticatedThisPage: hasAuthenticatedRef.current,
        graceMs,
        elapsedSinceLeftMs: opts.elapsedSinceLeftMs ?? null,
      })
      applyBioLockStorageEffect(sessionStorage, next.effect)
      lockedRef.current = next.locked
      setLocked(next.locked)
    }

    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") {
        writeAppLockLeftAt(sessionStorage, Date.now())
        applyEvent("left")
      } else {
        const suppressed = isAppLockSuppressed(sessionStorage)
        const elapsedSinceLeftMs = readAppLockElapsedSinceLeftMs(sessionStorage, Date.now())
        applyEvent("returned", { suppressed, elapsedSinceLeftMs })
        clearAppLockSuppressed(sessionStorage)
        clearAppLockLeftAt(sessionStorage)
      }
    }

    const onPageHide = (): void => {
      applyEvent("left")
    }
    const onBeforeUnload = (): void => {
      applyEvent("left")
    }

    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("pagehide", onPageHide)
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("pagehide", onPageHide)
      window.removeEventListener("beforeunload", onBeforeUnload)
    }
  }, [eligible, graceMs])

  const onUnlocked = useCallback(() => {
    const target = resolveAppLockUnlockTarget(
      null,
      locationPath(window.location),
    )
    const next = nextBioLockState({
      locked: true,
      event: "explicit-unlock",
      suppressed: false,
      hasAuthenticatedThisPage: hasAuthenticatedRef.current,
      graceMs,
      elapsedSinceLeftMs: null,
    })
    applyBioLockStorageEffect(sessionStorage, next.effect)
    clearAppLockPendingUrl(sessionStorage)
    lockedRef.current = next.locked
    setLocked(next.locked)
    router.push(target)
  }, [router, graceMs])

  const disableAppLock = useCallback(() => {
    if (userId) setAppLockDisabled(localStorage, userId, true)
    setOptedOut(true)
    onUnlocked()
  }, [userId, onUnlocked])

  return {
    locked,
    onUnlocked,
    disableAppLock,
    eligible,
    overlayUserId: userId,
    sessionAuthenticated: status === "authenticated" && session != null,
  }
}
