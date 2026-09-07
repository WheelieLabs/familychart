// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest"
import {
  formatStaleThresholdHours,
  hoursSinceRecorded,
  isStaleReading,
} from "@/lib/observation/observation-staleness"

describe("hoursSinceRecorded", () => {
  it("returns the elapsed hours between the recorded time and now", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2025-01-15T12:00:00.000Z"))
    expect(hoursSinceRecorded("2025-01-15T09:00:00.000Z")).toBeCloseTo(3, 5)
    vi.useRealTimers()
  })
})

describe("isStaleReading", () => {
  it("returns false when staleAfterHours is null or undefined", () => {
    expect(isStaleReading(new Date().toISOString(), null)).toBe(false)
    expect(isStaleReading(new Date().toISOString(), undefined)).toBe(false)
  })

  it("returns false when staleAfterHours is zero or negative", () => {
    expect(isStaleReading(new Date().toISOString(), 0)).toBe(false)
    expect(isStaleReading(new Date().toISOString(), -5)).toBe(false)
  })

  it("returns false when the reading is more recent than the threshold", () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1h ago
    expect(isStaleReading(recent, 24)).toBe(false)
  })

  it("returns true once the reading is at least as old as the threshold", () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() // 25h ago
    expect(isStaleReading(old, 24)).toBe(true)
  })
})

describe("formatStaleThresholdHours", () => {
  it("returns an empty string for non-finite or non-positive input", () => {
    expect(formatStaleThresholdHours(0)).toBe("")
    expect(formatStaleThresholdHours(-1)).toBe("")
    expect(formatStaleThresholdHours(NaN)).toBe("")
    expect(formatStaleThresholdHours(Infinity)).toBe("")
  })

  it("formats sub-day values in hours, singular for exactly 1", () => {
    expect(formatStaleThresholdHours(1)).toBe("1 hour")
    expect(formatStaleThresholdHours(12)).toBe("12 hours")
  })

  it("rounds sub-day values under 10 hours to one decimal place", () => {
    expect(formatStaleThresholdHours(2.34)).toBe("2.3 hours")
  })

  it("formats an exact single day as '1 day'", () => {
    expect(formatStaleThresholdHours(24)).toBe("1 day")
  })

  it("formats an exact week as '1 week'", () => {
    expect(formatStaleThresholdHours(24 * 7)).toBe("1 week")
  })

  it("formats other exact multi-day values as 'N days'", () => {
    expect(formatStaleThresholdHours(24 * 3)).toBe("3 days")
  })

  it("falls back to rounded hours for a value that isn't a whole number of days", () => {
    expect(formatStaleThresholdHours(30)).toBe("30 hours")
  })
})
