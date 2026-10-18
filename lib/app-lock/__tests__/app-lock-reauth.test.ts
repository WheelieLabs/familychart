// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import {
  ENTRA_APP_LOCK_REAUTH_MAX_AGE_MS,
  ENTRA_AUTH_TIME_CLOCK_SKEW_MS,
  applyEntraAuthTimeToToken,
  isEntraAppLockReauthFresh,
  resolveEntraAuthTimeMs,
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

describe("resolveEntraAuthTimeMs", () => {
  const now = 1_700_000_000_000

  it("converts the id_token auth_time (seconds) to ms", () => {
    expect(resolveEntraAuthTimeMs(now / 1000 - 30, now)).toBe(now - 30_000)
  })

  it("returns undefined when the claim is missing (fails closed)", () => {
    expect(resolveEntraAuthTimeMs(undefined, now)).toBeUndefined()
    expect(resolveEntraAuthTimeMs(null, now)).toBeUndefined()
  })

  it("returns undefined for non-numeric, non-finite or non-positive values", () => {
    for (const bad of ["1700000000", NaN, Infinity, 0, -5, {}, []]) {
      expect(resolveEntraAuthTimeMs(bad, now)).toBeUndefined()
    }
  })

  it("rejects an auth_time further in the future than the allowed clock skew", () => {
    const future = (now + ENTRA_AUTH_TIME_CLOCK_SKEW_MS + 1000) / 1000
    expect(resolveEntraAuthTimeMs(future, now)).toBeUndefined()
  })

  it("clamps a small future auth_time (clock skew) to now so it is still fresh", () => {
    const resolved = resolveEntraAuthTimeMs((now + 5000) / 1000, now)
    expect(resolved).toBe(now)
    expect(isEntraAppLockReauthFresh(resolved, now)).toBe(true)
  })

  it("keeps an old auth_time (silent SSO re-issue) so the freshness check rejects it", () => {
    const resolved = resolveEntraAuthTimeMs(now / 1000 - 3600, now)
    expect(resolved).toBe(now - 3_600_000)
    expect(isEntraAppLockReauthFresh(resolved, now)).toBe(false)
  })
})

describe("applyEntraAuthTimeToToken", () => {
  const now = 1_000_000_000

  it("sets entraAuthTime from a recent auth_time", () => {
    const token = applyEntraAuthTimeToToken({} as { entraAuthTime?: number }, { auth_time: now / 1000 - 30 }, now)
    expect(token.entraAuthTime).toBe(now - 30_000)
    expect(isEntraAppLockReauthFresh(token.entraAuthTime, now)).toBe(true)
  })

  it("sets an old auth_time as-is so step-up is refused by age", () => {
    const token = applyEntraAuthTimeToToken({} as { entraAuthTime?: number }, { auth_time: now / 1000 - 3600 }, now)
    expect(token.entraAuthTime).toBe(now - 3_600_000)
    expect(isEntraAppLockReauthFresh(token.entraAuthTime, now)).toBe(false)
  })

  it("deletes a stale entraAuthTime when the claim is missing or invalid", () => {
    for (const profile of [{}, { auth_time: "soon" }, { auth_time: -1 }]) {
      const token = applyEntraAuthTimeToToken({ entraAuthTime: now - 10 }, profile, now)
      expect("entraAuthTime" in token).toBe(false)
    }
  })
})
