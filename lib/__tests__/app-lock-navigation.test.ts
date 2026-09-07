import { describe, it, expect, afterEach, vi } from "vitest"
import {
  captureAppLockPendingUrl,
  clearAppLockPendingUrl,
  clearAppLockSuppressed,
  isAppLockNotificationDeepLink,
  isAppLockSuppressed,
  markAppLockSuppressed,
  readAppLockPendingUrl,
  resolveAppLockUnlockTarget,
  writeAppLockPendingUrl,
  FC_APP_LOCK_PENDING_URL_KEY,
} from "@/lib/app-lock-navigation"

function fakeStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
  }
}

/** Mirrors AppLockProvider's onVisibility decision: skip locking only while still suppressed. */
function shouldLockOnHide(storage: ReturnType<typeof fakeStorage>): boolean {
  return !isAppLockSuppressed(storage)
}
function shouldLockOnShow(storage: ReturnType<typeof fakeStorage>): boolean {
  const lock = !isAppLockSuppressed(storage)
  clearAppLockSuppressed(storage)
  return lock
}

describe("captureAppLockPendingUrl", () => {
  it("normalises paths without a leading slash", () => {
    expect(captureAppLockPendingUrl("5/history")).toBe("/5/history")
  })

  it("preserves query and hash segments", () => {
    expect(captureAppLockPendingUrl("/5/record-medication?medication_id=1&prompt=prn"))
      .toBe("/5/record-medication?medication_id=1&prompt=prn")
  })
})

describe("isAppLockNotificationDeepLink", () => {
  it("recognises medication notification URLs", () => {
    expect(
      isAppLockNotificationDeepLink(
        "/5/record-medication?medication_id=2&prompt=scheduled",
      ),
    ).toBe(true)
  })

  it("recognises observation notification URLs", () => {
    expect(isAppLockNotificationDeepLink("/5/record-observation?type=Hydration")).toBe(true)
    expect(isAppLockNotificationDeepLink("/5/record-observation?type=Weight")).toBe(true)
  })

  it("rejects non-notification paths", () => {
    expect(isAppLockNotificationDeepLink("/5/history")).toBe(false)
    expect(isAppLockNotificationDeepLink("/5/record-medication?prompt=prn")).toBe(false)
  })
})

describe("resolveAppLockUnlockTarget", () => {
  it("always goes home when there is no notification deep link", () => {
    expect(resolveAppLockUnlockTarget(null, "/")).toBe("/")
    expect(resolveAppLockUnlockTarget("/", "/")).toBe("/")
    expect(resolveAppLockUnlockTarget("/5/history", "/5/history")).toBe("/")
    expect(resolveAppLockUnlockTarget(null, "/5/history")).toBe("/")
  })

  it("lands on a medication notification deep link", () => {
    expect(
      resolveAppLockUnlockTarget(
        "/5/history",
        "/5/record-medication?medication_id=2&prompt=scheduled",
      ),
    ).toBe("/5/record-medication?medication_id=2&prompt=scheduled")
  })

  it("lands on an observation notification deep link on cold start", () => {
    expect(
      resolveAppLockUnlockTarget(
        null,
        "/5/record-observation?type=Weight",
      ),
    ).toBe("/5/record-observation?type=Weight")
  })

  it("ignores pending URL for same-page return", () => {
    expect(resolveAppLockUnlockTarget("/5/history", "/5/history")).toBe("/")
  })

  it("does not resume arbitrary record URLs without notification query params", () => {
    expect(resolveAppLockUnlockTarget(null, "/3/record-medication?prompt=prn")).toBe("/")
  })
})

describe("pending URL sessionStorage helpers", () => {
  it("writes, reads, and clears the pending path", () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    }

    writeAppLockPendingUrl(storage, "/2/history")
    expect(readAppLockPendingUrl(storage)).toBe("/2/history")
    clearAppLockPendingUrl(storage)
    expect(readAppLockPendingUrl(storage)).toBeNull()
    expect(store.has(FC_APP_LOCK_PENDING_URL_KEY)).toBe(false)
  })
})

describe("app-lock photo-picker suppression", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("does not lock on hide right after marking suppressed", () => {
    const storage = fakeStorage()
    markAppLockSuppressed(storage)
    expect(shouldLockOnHide(storage)).toBe(false)
  })

  it("suppressed hide followed by a quick show does not lock", () => {
    vi.useFakeTimers()
    const storage = fakeStorage()
    markAppLockSuppressed(storage)
    expect(shouldLockOnHide(storage)).toBe(false)

    vi.advanceTimersByTime(2 * 1000)
    expect(shouldLockOnShow(storage)).toBe(false)
    expect(isAppLockSuppressed(storage)).toBe(false)
  })

  it("suppressed hide followed by a show after the TTL lapses locks", () => {
    vi.useFakeTimers()
    const storage = fakeStorage()
    markAppLockSuppressed(storage)
    expect(shouldLockOnHide(storage)).toBe(false)

    vi.advanceTimersByTime(6 * 60 * 1000)
    expect(shouldLockOnShow(storage)).toBe(true)
  })

  it("unsuppressed hide followed by a show locks", () => {
    const storage = fakeStorage()
    expect(shouldLockOnHide(storage)).toBe(true)
    expect(shouldLockOnShow(storage)).toBe(true)
  })
})
