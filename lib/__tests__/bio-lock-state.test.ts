// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import {
  APP_LOCK_GRACE_PERIOD_MS,
  FC_BIO_UNLOCK_KEY,
  bioLockIsLockedFromUnlockKey,
  clearBioUnlockKey,
  getAppLockGracePeriod,
  isAppLockDisabled,
  nextBioLockState,
  readBioUnlockKey,
  setAppLockDisabled,
  setAppLockGracePeriod,
  writeBioUnlockKey,
} from "@/lib/bio-lock-state"

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
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

describe("bioLockIsLockedFromUnlockKey", () => {
  it("defaults to locked until the unlock key is proven", () => {
    expect(bioLockIsLockedFromUnlockKey(null)).toBe(true)
    expect(bioLockIsLockedFromUnlockKey("")).toBe(true)
    expect(bioLockIsLockedFromUnlockKey("0")).toBe(true)
    expect(bioLockIsLockedFromUnlockKey("1")).toBe(false)
  })
})

describe("isAppLockDisabled / setAppLockDisabled", () => {
  it("defaults to not disabled", () => {
    const storage = memoryStorage()
    expect(isAppLockDisabled(storage, "alice")).toBe(false)
  })

  it("disables and re-enables app-lock for a given account", () => {
    const storage = memoryStorage()
    setAppLockDisabled(storage, "alice", true)
    expect(isAppLockDisabled(storage, "alice")).toBe(true)

    setAppLockDisabled(storage, "alice", false)
    expect(isAppLockDisabled(storage, "alice")).toBe(false)
  })

  it("scopes the opt-out to a single account, not the whole device", () => {
    const storage = memoryStorage()
    setAppLockDisabled(storage, "alice", true)
    expect(isAppLockDisabled(storage, "bob")).toBe(false)
  })

  it("does nothing for a blank user id", () => {
    const storage = memoryStorage()
    setAppLockDisabled(storage, "   ", true)
    expect(isAppLockDisabled(storage, "   ")).toBe(false)
  })
})

describe("getAppLockGracePeriod / setAppLockGracePeriod", () => {
  it("defaults to immediate", () => {
    const storage = memoryStorage()
    expect(getAppLockGracePeriod(storage, "alice")).toBe("immediate")
  })

  it("stores and reads each grace choice, per account", () => {
    const storage = memoryStorage()
    for (const period of ["30s", "1m", "5m"] as const) {
      setAppLockGracePeriod(storage, "alice", period)
      expect(getAppLockGracePeriod(storage, "alice")).toBe(period)
      expect(getAppLockGracePeriod(storage, "bob")).toBe("immediate")
    }
  })

  it("setting back to immediate clears the stored value", () => {
    const storage = memoryStorage()
    setAppLockGracePeriod(storage, "alice", "5m")
    setAppLockGracePeriod(storage, "alice", "immediate")
    expect(getAppLockGracePeriod(storage, "alice")).toBe("immediate")
  })

  it("falls back to immediate for a corrupt/unknown stored value", () => {
    const storage = memoryStorage({ "familychart_app_lock_grace:alice": "9001-seconds" })
    expect(getAppLockGracePeriod(storage, "alice")).toBe("immediate")
  })

  it("the grace choices map to the expected millisecond values", () => {
    expect(APP_LOCK_GRACE_PERIOD_MS).toEqual({
      immediate: 0,
      "30s": 30_000,
      "1m": 60_000,
      "5m": 300_000,
    })
  })
})

function transition(overrides: Partial<Parameters<typeof nextBioLockState>[0]>) {
  return nextBioLockState({
    locked: false,
    event: "left",
    suppressed: false,
    hasAuthenticatedThisPage: true,
    graceMs: 0,
    elapsedSinceLeftMs: null,
    ...overrides,
  })
}

describe("nextBioLockState", () => {
  it("'left' never changes the lock state by itself — the decision happens on 'returned'", () => {
    expect(transition({ locked: false, event: "left" })).toEqual({ locked: false, effect: "none" })
    expect(transition({ locked: true, event: "left" })).toEqual({ locked: true, effect: "none" })
  })

  describe("'returned'", () => {
    it("re-locks when there is no grace and no suppression", () => {
      expect(
        transition({ locked: false, event: "returned", graceMs: 0, elapsedSinceLeftMs: 1 }),
      ).toEqual({ locked: true, effect: "clear-unlock-key" })
    })

    it("does not re-lock while a picker suppression is live, regardless of elapsed time", () => {
      expect(
        transition({
          locked: false,
          event: "returned",
          suppressed: true,
          elapsedSinceLeftMs: 10 * 60_000,
        }),
      ).toEqual({ locked: false, effect: "none" })
    })

    it.each([
      ["30s", 30_000],
      ["1m", 60_000],
      ["5m", 300_000],
    ] as const)("grace '%s': stays unlocked just under, re-locks just over", (_label, graceMs) => {
      expect(
        transition({ locked: false, event: "returned", graceMs, elapsedSinceLeftMs: graceMs - 1 }),
      ).toEqual({ locked: false, effect: "none" })
      expect(
        transition({ locked: false, event: "returned", graceMs, elapsedSinceLeftMs: graceMs + 1 }),
      ).toEqual({ locked: true, effect: "clear-unlock-key" })
    })

    it("elapsed exactly at the grace boundary still counts as within grace", () => {
      expect(
        transition({ locked: false, event: "returned", graceMs: 60_000, elapsedSinceLeftMs: 60_000 }),
      ).toEqual({ locked: false, effect: "none" })
    })

    it("the 'immediate' default (graceMs 0) re-locks on any elapsed time", () => {
      expect(
        transition({ locked: false, event: "returned", graceMs: 0, elapsedSinceLeftMs: 1 }),
      ).toEqual({ locked: true, effect: "clear-unlock-key" })
    })

    it("re-locks when elapsed time since leaving is unknown", () => {
      expect(
        transition({ locked: false, event: "returned", graceMs: 60_000, elapsedSinceLeftMs: null }),
      ).toEqual({ locked: true, effect: "clear-unlock-key" })
    })
  })

  it("'fresh-start' always locks, regardless of any prior state", () => {
    expect(transition({ locked: false, event: "fresh-start" })).toEqual({
      locked: true,
      effect: "clear-unlock-key",
    })
    expect(transition({ locked: true, event: "fresh-start" })).toEqual({
      locked: true,
      effect: "clear-unlock-key",
    })
  })

  it("'in-app-navigation' never changes the lock state", () => {
    expect(transition({ locked: false, event: "in-app-navigation" })).toEqual({
      locked: false,
      effect: "none",
    })
    expect(transition({ locked: true, event: "in-app-navigation" })).toEqual({
      locked: true,
      effect: "none",
    })
  })

  describe("'session-unconfirmed' (fail-closed)", () => {
    it("never unlocks once the Account has been authenticated in this page", () => {
      expect(
        transition({ locked: true, event: "session-unconfirmed", hasAuthenticatedThisPage: true }),
      ).toEqual({ locked: true, effect: "clear-unlock-key" })
      expect(
        transition({ locked: false, event: "session-unconfirmed", hasAuthenticatedThisPage: true }),
      ).toEqual({ locked: true, effect: "clear-unlock-key" })
    })

    it("is a no-op before the first authentication in this page", () => {
      expect(
        transition({ locked: true, event: "session-unconfirmed", hasAuthenticatedThisPage: false }),
      ).toEqual({ locked: true, effect: "none" })
    })
  })

  it("'session-confirmed-signed-out' unlocks and clears the unlock key", () => {
    expect(transition({ locked: true, event: "session-confirmed-signed-out" })).toEqual({
      locked: false,
      effect: "clear-unlock-key",
    })
  })

  it("'explicit-unlock' unlocks and sets the unlock key", () => {
    expect(transition({ locked: true, event: "explicit-unlock" })).toEqual({
      locked: false,
      effect: "set-unlock-key",
    })
  })

  it("'settings-changed' never changes the lock state", () => {
    expect(transition({ locked: false, event: "settings-changed" })).toEqual({
      locked: false,
      effect: "none",
    })
    expect(transition({ locked: true, event: "settings-changed" })).toEqual({
      locked: true,
      effect: "none",
    })
  })
})

describe("bio unlock key storage helpers", () => {
  it("writes, reads, and clears the tab unlock key", () => {
    const storage = memoryStorage()
    expect(readBioUnlockKey(storage)).toBeNull()
    writeBioUnlockKey(storage)
    expect(readBioUnlockKey(storage)).toBe("1")
    expect(storage.getItem(FC_BIO_UNLOCK_KEY)).toBe("1")
    clearBioUnlockKey(storage)
    expect(readBioUnlockKey(storage)).toBeNull()
  })
})
