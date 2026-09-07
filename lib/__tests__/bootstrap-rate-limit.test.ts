// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  isBootstrapRateLimited,
  recordBootstrapAttempt,
  resetAuthRateLimitForTests,
} from "@/lib/auth/auth-rate-limit"

describe("bootstrap rate limit", () => {
  beforeEach(() => {
    resetAuthRateLimitForTests()
  })

  afterEach(() => {
    resetAuthRateLimitForTests()
  })

  it("allows the first five attempts then locks the IP", () => {
    const ip = "203.0.113.10"
    expect(isBootstrapRateLimited(ip)).toBe(false)
    for (let i = 0; i < 5; i++) {
      recordBootstrapAttempt(ip)
    }
    expect(isBootstrapRateLimited(ip)).toBe(true)
  })

  it("isolates buckets per IP", () => {
    for (let i = 0; i < 5; i++) {
      recordBootstrapAttempt("1.1.1.1")
    }
    expect(isBootstrapRateLimited("1.1.1.1")).toBe(true)
    expect(isBootstrapRateLimited("2.2.2.2")).toBe(false)
  })

  it("resets after the window elapses", () => {
    const ip = "9.9.9.9"
    const t0 = 1_000_000
    for (let i = 0; i < 5; i++) {
      recordBootstrapAttempt(ip, t0)
    }
    expect(isBootstrapRateLimited(ip, t0)).toBe(true)
    const afterWindow = t0 + 15 * 60_000 + 1
    expect(isBootstrapRateLimited(ip, afterWindow)).toBe(false)
    recordBootstrapAttempt(ip, afterWindow)
    expect(isBootstrapRateLimited(ip, afterWindow)).toBe(false)
  })
})
