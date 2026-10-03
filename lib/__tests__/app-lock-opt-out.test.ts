import { describe, it, expect } from "vitest"
import {
  APP_LOCK_OPT_OUT_FAILURE_THRESHOLD,
  shouldOfferAppLockOptOut,
} from "@/lib/app-lock-opt-out"

describe("shouldOfferAppLockOptOut", () => {
  it("is hidden with no failures", () => {
    expect(shouldOfferAppLockOptOut({ consecutiveFailures: 0, setupAfterResetFailed: false })).toBe(false)
  })

  it("is hidden after a single failure", () => {
    expect(shouldOfferAppLockOptOut({ consecutiveFailures: 1, setupAfterResetFailed: false })).toBe(false)
  })

  it("is hidden after two consecutive failures", () => {
    expect(shouldOfferAppLockOptOut({ consecutiveFailures: 2, setupAfterResetFailed: false })).toBe(false)
  })

  it("appears after three consecutive failures", () => {
    expect(APP_LOCK_OPT_OUT_FAILURE_THRESHOLD).toBe(3)
    expect(shouldOfferAppLockOptOut({ consecutiveFailures: 3, setupAfterResetFailed: false })).toBe(true)
  })

  it("appears once set-up-again has failed, even on the first failure after reset", () => {
    expect(shouldOfferAppLockOptOut({ consecutiveFailures: 1, setupAfterResetFailed: true })).toBe(true)
  })
})
