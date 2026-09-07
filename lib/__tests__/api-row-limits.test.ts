import { describe, expect, it } from "vitest"
import { MAX_HISTORY_ROWS, clampHistoryLimit } from "@/lib/api-row-limits"

describe("clampHistoryLimit", () => {
  it("falls back to the hard cap when limit is absent", () => {
    expect(clampHistoryLimit(null)).toBe(MAX_HISTORY_ROWS)
  })

  it("falls back to the hard cap for non-numeric input", () => {
    expect(clampHistoryLimit("abc")).toBe(MAX_HISTORY_ROWS)
  })

  it("falls back to the hard cap for zero or negative input", () => {
    expect(clampHistoryLimit("0")).toBe(MAX_HISTORY_ROWS)
    expect(clampHistoryLimit("-5")).toBe(MAX_HISTORY_ROWS)
  })

  it("passes through a valid limit under the cap", () => {
    expect(clampHistoryLimit("50")).toBe(50)
  })

  it("clamps a limit above the cap down to the cap", () => {
    expect(clampHistoryLimit(String(MAX_HISTORY_ROWS + 10_000))).toBe(MAX_HISTORY_ROWS)
  })

  it("allows a limit exactly at the cap", () => {
    expect(clampHistoryLimit(String(MAX_HISTORY_ROWS))).toBe(MAX_HISTORY_ROWS)
  })
})
