// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import {
  ENTRA_APP_LOCK_REAUTH_MAX_AGE_MS,
  isEntraAppLockReauthFresh,
} from "@/lib/app-lock/app-lock-reauth"

describe("isEntraAppLockReauthFresh", () => {
  const now = 1_000_000

  it("is fresh just under the max age", () => {
    expect(
      isEntraAppLockReauthFresh(now - (ENTRA_APP_LOCK_REAUTH_MAX_AGE_MS - 1), now),
    ).toBe(true)
  })

  it("is stale just over the max age", () => {
    expect(
      isEntraAppLockReauthFresh(now - (ENTRA_APP_LOCK_REAUTH_MAX_AGE_MS + 1), now),
    ).toBe(false)
  })

  it("is fresh at exactly the max age boundary", () => {
    expect(isEntraAppLockReauthFresh(now - ENTRA_APP_LOCK_REAUTH_MAX_AGE_MS, now)).toBe(true)
  })

  it("rejects a timestamp from the future (clock skew / forged value)", () => {
    expect(isEntraAppLockReauthFresh(now + 1000, now)).toBe(false)
  })

  it("rejects null/undefined — no Entra sign-in recorded on this session", () => {
    expect(isEntraAppLockReauthFresh(null, now)).toBe(false)
    expect(isEntraAppLockReauthFresh(undefined, now)).toBe(false)
  })

  it("honours a custom max age", () => {
    expect(isEntraAppLockReauthFresh(now - 10_000, now, 5_000)).toBe(false)
    expect(isEntraAppLockReauthFresh(now - 4_000, now, 5_000)).toBe(true)
  })
})
