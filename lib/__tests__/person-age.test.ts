import { describe, it, expect } from "vitest"
import { ianaLocalYmdHmToUtcMs } from "@/lib/datetime"
import {
  completedCalendarYears,
  fractionalAgeYears,
  normalizeAgeTimeZone,
} from "@/lib/person/person-age"

/** Instant at wall midnight in the given IANA zone. */
function wallMidnight(ymd: string, timeZone: string): Date {
  return new Date(ianaLocalYmdHmToUtcMs(ymd, "00:00", timeZone))
}

describe("normalizeAgeTimeZone", () => {
  it("returns UTC for empty or invalid", () => {
    expect(normalizeAgeTimeZone("")).toBe("UTC")
    expect(normalizeAgeTimeZone("   ")).toBe("UTC")
    expect(normalizeAgeTimeZone("Not/AZone")).toBe("UTC")
  })

  it("returns trimmed valid IANA names", () => {
    expect(normalizeAgeTimeZone("Australia/Adelaide")).toBe("Australia/Adelaide")
    expect(normalizeAgeTimeZone(" UTC ")).toBe("UTC")
  })
})

describe("fractionalAgeYears", () => {
  it("returns NaN for empty or unparseable DOB", () => {
    expect(fractionalAgeYears("", "UTC")).toBeNaN()
    expect(fractionalAgeYears("not-a-date", "UTC")).toBeNaN()
  })

  it("is exactly N years when asOf is N × 365.25 days after DOB midnight", () => {
    const dob = "2000-06-15"
    const tz = "UTC"
    const asOf = new Date(wallMidnight(dob, tz).getTime() + 18 * 365.25 * 864e5)
    expect(fractionalAgeYears(dob, tz, asOf)).toBe(18)
  })

  it("increases across a calendar birthday (may still be under 18 on the day)", () => {
    const dob = "2008-06-15"
    const tz = "UTC"
    const dayBefore = fractionalAgeYears(dob, tz, wallMidnight("2026-06-14", tz))
    const onDay = fractionalAgeYears(dob, tz, wallMidnight("2026-06-15", tz))
    expect(onDay).toBeGreaterThan(dayBefore)
    // 18 calendar years ≠ 18 × 365.25 days when leap days intervene
    expect(onDay).toBeLessThan(18)
    expect(completedCalendarYears(dob, tz, wallMidnight("2026-06-15", tz))).toBe(18)
  })

  it("uses DOB midnight in the named zone (Adelaide vs UTC disagree near the boundary)", () => {
    const dob = "2008-06-15"
    // 2026-06-14 14:30 UTC = 2026-06-15 00:00 Australia/Adelaide (ACST, UTC+9:30)
    const adelaideBirthdayStartUtc = new Date("2026-06-14T14:30:00.000Z")
    const justBefore = new Date(adelaideBirthdayStartUtc.getTime() - 60_000)

    expect(completedCalendarYears(dob, "Australia/Adelaide", justBefore)).toBe(17)
    expect(completedCalendarYears(dob, "Australia/Adelaide", adelaideBirthdayStartUtc)).toBe(18)
    // Same UTC instants are still 14 June in UTC — calendar age stays 17
    expect(completedCalendarYears(dob, "UTC", justBefore)).toBe(17)
    expect(completedCalendarYears(dob, "UTC", adelaideBirthdayStartUtc)).toBe(17)
  })
})

describe("completedCalendarYears", () => {
  it("returns NaN for empty or unparseable DOB", () => {
    expect(completedCalendarYears("", "UTC")).toBeNaN()
    expect(completedCalendarYears("not-a-date", "UTC")).toBeNaN()
  })

  it("is 17 the day before the 18th birthday and 18 on the birthday", () => {
    const tz = "UTC"
    expect(completedCalendarYears("2008-06-15", tz, wallMidnight("2026-06-14", tz))).toBe(17)
    expect(completedCalendarYears("2008-06-15", tz, wallMidnight("2026-06-15", tz))).toBe(18)
  })

  it("ticks a Feb 29 DOB on 1 March in a non-leap year", () => {
    const tz = "UTC"
    expect(completedCalendarYears("2000-02-29", tz, wallMidnight("2018-02-28", tz))).toBe(17)
    expect(completedCalendarYears("2000-02-29", tz, wallMidnight("2018-03-01", tz))).toBe(18)
  })

  it("ticks a Feb 29 DOB on Feb 29 in a leap year", () => {
    const tz = "UTC"
    expect(completedCalendarYears("2000-02-29", tz, wallMidnight("2020-02-28", tz))).toBe(19)
    expect(completedCalendarYears("2000-02-29", tz, wallMidnight("2020-02-29", tz))).toBe(20)
  })

  it("treats invalid timeZone as UTC", () => {
    const asOf = wallMidnight("2026-06-15", "UTC")
    expect(completedCalendarYears("2008-06-15", "Not/AZone", asOf)).toBe(
      completedCalendarYears("2008-06-15", "UTC", asOf),
    )
  })
})
