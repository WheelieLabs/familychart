// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  isAuthRateLimitedForLocalUser,
  recordAuthFailureForLocalUser,
  resetAuthRateLimitForTests,
  clearAuthFailuresForLocalUser,
} from "@/lib/auth/auth-rate-limit"

describe("auth rate limit for local-user re-auth", () => {
  beforeEach(() => {
    resetAuthRateLimitForTests()
  })

  afterEach(() => {
    resetAuthRateLimitForTests()
  })

  it("locks after repeated failures for the same local user", () => {
    const ip = "1.2.3.4"
    const localId = 42
    expect(isAuthRateLimitedForLocalUser(ip, localId)).toBe(false)
    for (let i = 0; i < 10; i++) {
      recordAuthFailureForLocalUser(ip, localId)
    }
    expect(isAuthRateLimitedForLocalUser(ip, localId)).toBe(true)
  })

  it("clears on successful re-auth", () => {
    const ip = "1.2.3.4"
    const localId = 7
    for (let i = 0; i < 10; i++) {
      recordAuthFailureForLocalUser(ip, localId)
    }
    expect(isAuthRateLimitedForLocalUser(ip, localId)).toBe(true)
    clearAuthFailuresForLocalUser(ip, localId)
    expect(isAuthRateLimitedForLocalUser(ip, localId)).toBe(false)
  })

  it("isolates buckets per local user", () => {
    const ip = "9.9.9.9"
    for (let i = 0; i < 10; i++) {
      recordAuthFailureForLocalUser(ip, 1)
    }
    expect(isAuthRateLimitedForLocalUser(ip, 1)).toBe(true)
    expect(isAuthRateLimitedForLocalUser(ip, 2)).toBe(false)
  })
})
