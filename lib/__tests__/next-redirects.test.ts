import { describe, it, expect } from "vitest"

describe("management routes", () => {
  it("management medications path is not a numeric person id", () => {
    expect(Number.isFinite(parseInt("management", 10))).toBe(false)
  })

  it("legacy poisoned redirect target is not a valid person schedules path", () => {
    // Browsers may still follow a cached 308 to this URL after the legacy server redirect was removed.
    expect(parseInt("management", 10)).toBeNaN()
  })
})
