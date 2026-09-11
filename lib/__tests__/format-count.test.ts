import { describe, it, expect } from "vitest"
import { formatCount, formatUnitCount } from "@/lib/format-count"

describe("formatCount", () => {
  it("uses the singular form for a count of 1", () => {
    expect(formatCount(1, "glass", "glasses")).toBe("1 glass")
  })

  it("uses the plural form for counts other than 1", () => {
    expect(formatCount(0, "glass", "glasses")).toBe("0 glasses")
    expect(formatCount(2, "glass", "glasses")).toBe("2 glasses")
  })

  it("derives a default plural by appending s", () => {
    expect(formatCount(1, "yr")).toBe("1 yr")
    expect(formatCount(2, "yr")).toBe("2 yrs")
  })
})

describe("formatUnitCount", () => {
  it("strips a trailing s for a count of 1 on free-text catalogue units", () => {
    expect(formatUnitCount(1, "Tabs")).toBe("1 Tab")
    expect(formatUnitCount(1, "Tablets")).toBe("1 Tablet")
  })

  it("leaves the unit unchanged for counts other than 1", () => {
    expect(formatUnitCount(2, "Tabs")).toBe("2 Tabs")
  })

  it("leaves units without a trailing s unchanged", () => {
    expect(formatUnitCount(1, "mL")).toBe("1 mL")
  })

  it("pluralises applications correctly", () => {
    expect(formatUnitCount(1, "applications")).toBe("1 application")
    expect(formatUnitCount(2, "applications")).toBe("2 applications")
  })
})
