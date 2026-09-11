// SPDX-License-Identifier: AGPL-3.0-only

/** sessionStorage key for the path captured when app-lock engages (visibility hidden). */
export const FC_APP_LOCK_PENDING_URL_KEY = "fc_app_lock_pending_url"

function normaliseAppPath(path: string): string {
  if (!path || path === "/") return "/"
  return path.startsWith("/") ? path : `/${path}`
}

/** Record the current in-app path when the tab is locked (backgrounded). */
export function captureAppLockPendingUrl(currentPath: string): string {
  return normaliseAppPath(currentPath)
}

/**
 * Push-notification deep links opened while the app is locked.
 * Shapes from lib/cron-notification-payloads.ts.
 */
export function isAppLockNotificationDeepLink(path: string): boolean {
  const current = normaliseAppPath(path)
  const pathname = current.split("?")[0] ?? current
  const search = current.includes("?") ? current.slice(current.indexOf("?")) : ""

  if (/^\/[^/]+\/record-medication$/.test(pathname)) {
    return search.includes("medication_id=") && search.includes("prompt=")
  }
  if (/^\/[^/]+\/record-observation$/.test(pathname)) {
    return search.includes("type=")
  }
  return false
}

/**
 * Choose where to navigate after a successful app-lock unlock.
 * Notification deep links resume the action URL; all other unlocks go home.
 */
export function resolveAppLockUnlockTarget(
  _pendingUrl: string | null | undefined,
  currentUrl: string,
): string {
  const current = normaliseAppPath(currentUrl)
  if (isAppLockNotificationDeepLink(current)) {
    return current
  }
  return "/"
}

export function readAppLockPendingUrl(
  storage: Pick<Storage, "getItem">,
): string | null {
  try {
    return storage.getItem(FC_APP_LOCK_PENDING_URL_KEY)
  } catch {
    return null
  }
}

export function writeAppLockPendingUrl(
  storage: Pick<Storage, "setItem">,
  path: string,
): void {
  try {
    storage.setItem(FC_APP_LOCK_PENDING_URL_KEY, normaliseAppPath(path))
  } catch {
    /* ignore */
  }
}

export function clearAppLockPendingUrl(
  storage: Pick<Storage, "removeItem">,
): void {
  try {
    storage.removeItem(FC_APP_LOCK_PENDING_URL_KEY)
  } catch {
    /* ignore */
  }
}

/** Full path (pathname + search + hash) from a Location-like object. */
export function locationPath(loc: Pick<Location, "pathname" | "search" | "hash">): string {
  return `${loc.pathname}${loc.search}${loc.hash}`
}

/** sessionStorage key marking that the next backgrounding is an in-app camera/file picker, not the user leaving. */
export const FC_APP_LOCK_SUPPRESS_KEY = "fc_app_lock_suppress_until"

/**
 * Covers only the genuine picker round-trip (tap → native picker opens → tab hides, and back).
 * Re-validated on the `visible` transition too, so it can't be used to hold a lock open indefinitely.
 */
const APP_LOCK_SUPPRESS_TTL_MS = 10 * 1000

/** Call right before triggering a native camera/file input, so AppLock doesn't fire on the resulting backgrounding. */
export function markAppLockSuppressed(storage: Pick<Storage, "setItem">): void {
  try {
    storage.setItem(FC_APP_LOCK_SUPPRESS_KEY, String(Date.now() + APP_LOCK_SUPPRESS_TTL_MS))
  } catch {
    /* ignore */
  }
}

export function clearAppLockSuppressed(storage: Pick<Storage, "removeItem">): void {
  try {
    storage.removeItem(FC_APP_LOCK_SUPPRESS_KEY)
  } catch {
    /* ignore */
  }
}

export function isAppLockSuppressed(storage: Pick<Storage, "getItem">): boolean {
  try {
    const raw = storage.getItem(FC_APP_LOCK_SUPPRESS_KEY)
    if (!raw) return false
    const expiry = Number(raw)
    return Number.isFinite(expiry) && Date.now() < expiry
  } catch {
    return false
  }
}
