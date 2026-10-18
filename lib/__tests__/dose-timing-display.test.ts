import { describe, expect, it } from "vitest"
import { doseTimingFromOutcome, formatGap, timingBadgeLabel } from "@/lib/medication/dose-timing-display"

describe("timingBadgeLabel", () => {
  it("says by how much a dose was late or early", () => {
    expect(timingBadgeLabel({ result: "late", offsetMinutes: 41 })).toBe("41 min late")
    expect(timingBadgeLabel({ result: "early", offsetMinutes: -38 })).toBe("38 min early")
  })

  it("leaves On time and unlabelled doses unmarked", () => {
    expect(timingBadgeLabel({ result: "on_time", offsetMinutes: 4 })).toBeNull()
    expect(timingBadgeLabel(null)).toBeNull()
  })

  it("reads an hour or more in hours", () => {
    expect(formatGap(60)).toBe("1 h")
    expect(timingBadgeLabel({ result: "late", offsetMinutes: 125 })).toBe("2 h 5 min late")
  })
})

describe("doseTimingFromOutcome", () => {
  const base = { slotHhmm: "12:00", recordId: 9 as number | null }
  it("keeps the timing of an attached dose", () => {
    expect(doseTimingFromOutcome({ ...base, result: "late", offsetMinutes: 41 })).toEqual({
      result: "late", offsetMinutes: 41, slotHhmm: "12:00",
    })
  })
  it("has no timing for Missed, given-away-from-home or an unattached row", () => {
    expect(doseTimingFromOutcome({ ...base, result: "missed", offsetMinutes: null, recordId: null })).toBeNull()
    expect(doseTimingFromOutcome({ ...base, result: "given", offsetMinutes: null })).toBeNull()
  })
})
