// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import {
  ENTRA_APP_LOCK_REAUTH_MAX_AGE_MS,
  applyLocalAuthAtToToken,
  isLocalRecentSignInFresh,
} from "@/lib/app-lock/app-lock-reauth"

describe("applyLocalAuthAtToToken", () => {
  it("stamps the sign-in time for the credentials provider", () => {
    expect(applyLocalAuthAtToToken({}, "credentials", 1_000)).toEqual({ localAuthAt: 1_000 })
  })

  it("clears any stamp for another provider", () => {
    const token = applyLocalAuthAtToToken({ localAuthAt: 5 }, "microsoft-entra-id", 1_000)
    expect(token).toEqual({})
  })

  it("replaces an older stamp on a new password sign-in", () => {
    expect(applyLocalAuthAtToToken({ localAuthAt: 5 }, "credentials", 9_000)).toEqual({ localAuthAt: 9_000 })
  })
})

describe("isLocalRecentSignInFresh", () => {
  const now = 10_000_000
  it("accepts a recent sign-in and the window edge", () => {
    expect(isLocalRecentSignInFresh(now - 1_000, now)).toBe(true)
    expect(isLocalRecentSignInFresh(now - ENTRA_APP_LOCK_REAUTH_MAX_AGE_MS, now)).toBe(true)
  })
  it("rejects old, missing, non-finite and future-dated values", () => {
    expect(isLocalRecentSignInFresh(now - ENTRA_APP_LOCK_REAUTH_MAX_AGE_MS - 1, now)).toBe(false)
    expect(isLocalRecentSignInFresh(undefined, now)).toBe(false)
    expect(isLocalRecentSignInFresh(Number.NaN, now)).toBe(false)
    expect(isLocalRecentSignInFresh(now + 1, now)).toBe(false)
  })
})
