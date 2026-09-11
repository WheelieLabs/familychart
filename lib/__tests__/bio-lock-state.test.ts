// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import {
  FC_BIO_UNLOCK_KEY,
  bioLockIsLockedFromUnlockKey,
  clearBioUnlockKey,
  nextBioLockState,
  readBioUnlockKey,
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

describe("nextBioLockState", () => {
  it("locks on hide when suppression is not live", () => {
    expect(
      nextBioLockState({
        locked: false,
        event: "visibility-hidden",
        suppressed: false,
      }),
    ).toEqual({ locked: true, effect: "clear-unlock-key" })
  })

  it("does not lock on hide while suppression is live", () => {
    expect(
      nextBioLockState({
        locked: false,
        event: "visibility-hidden",
        suppressed: true,
      }),
    ).toEqual({ locked: false, effect: "none" })
  })

  it("re-locks on visible when suppression has already expired", () => {
    expect(
      nextBioLockState({
        locked: false,
        event: "visibility-shown",
        suppressed: false,
      }),
    ).toEqual({ locked: true, effect: "clear-unlock-key" })
  })

  it("does not re-lock on visible while suppression is still live", () => {
    expect(
      nextBioLockState({
        locked: false,
        event: "visibility-shown",
        suppressed: true,
      }),
    ).toEqual({ locked: false, effect: "none" })
  })

  it("clears the unlock key on unload without changing locked", () => {
    expect(
      nextBioLockState({
        locked: false,
        event: "pagehide",
        suppressed: false,
      }),
    ).toEqual({ locked: false, effect: "clear-unlock-key" })
    expect(
      nextBioLockState({
        locked: true,
        event: "beforeunload",
        suppressed: true,
      }),
    ).toEqual({ locked: true, effect: "clear-unlock-key" })
  })

  it("unlocks and clears the unlock key when the session becomes unauthenticated", () => {
    expect(
      nextBioLockState({
        locked: true,
        event: "session-status-unauthenticated",
        suppressed: false,
      }),
    ).toEqual({ locked: false, effect: "clear-unlock-key" })
  })

  it("unlocks and sets the unlock key on an explicit unlock", () => {
    expect(
      nextBioLockState({
        locked: true,
        event: "explicit-unlock",
        suppressed: false,
      }),
    ).toEqual({ locked: false, effect: "set-unlock-key" })
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
