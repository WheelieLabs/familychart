import { describe, it, expect } from "vitest"
import { addCalendarDaysToIsoYmd, dayQualifierForYmd, ianaLocalYmdHmToUtcMs, localCalendarYmdHmToUtcMs, localDateToIsoYmd } from "@/lib/datetime"

describe("dayQualifierForYmd", () => {
  it("returns null for same-day", () => {
    expect(dayQualifierForYmd("2026-07-12", "2026-07-12", "2026-07-13")).toBeNull()
  })

  it("returns 'tomorrow' for next-day", () => {
    expect(dayQualifierForYmd("2026-07-13", "2026-07-12", "2026-07-13")).toBe("tomorrow")
  })

  it("falls back to weekday+date for other days", () => {
    // 2026-07-15 is a Wednesday
    expect(dayQualifierForYmd("2026-07-15", "2026-07-12", "2026-07-13")).toBe("Wed 15 Jul")
  })
})

describe("localDateToIsoYmd", () => {
  it("formats single-digit month and day with zero padding", () => {
    expect(localDateToIsoYmd(new Date(2024, 0, 5))).toBe("2024-01-05")
    expect(localDateToIsoYmd(new Date(2024, 8, 9))).toBe("2024-09-09")
  })

  it("handles month boundaries", () => {
    expect(localDateToIsoYmd(new Date(2024, 11, 31))).toBe("2024-12-31")
    expect(localDateToIsoYmd(new Date(2025, 0, 1))).toBe("2025-01-01")
  })
})

describe("history daysAgo pattern", () => {
  it("subtracts whole calendar days from a local date", () => {
    const anchor = new Date(2024, 2, 15)
    expect(addCalendarDaysToIsoYmd(localDateToIsoYmd(anchor), -7)).toBe("2024-03-08")
    expect(addCalendarDaysToIsoYmd(localDateToIsoYmd(anchor), -30)).toBe("2024-02-14")
  })
})

describe("ianaLocalYmdHmToUtcMs", () => {
  const tz = "Australia/Sydney"

  it("matches a fixed offset helper when DST is stable", () => {
    const ymd = "2024-06-15"
    const offsetMinutes = -600 // AEST, no DST in mid-June
    expect(ianaLocalYmdHmToUtcMs(ymd, "00:00", tz)).toBe(
      localCalendarYmdHmToUtcMs(ymd, "00:00", offsetMinutes),
    )
  })

  it("uses distinct offsets at today and tomorrow midnight on DST end day", () => {
    // 2024-04-07: clocks fall back at 03:00 → Apr 7 00:00 is AEDT, Apr 8 00:00 is AEST
    const startMs = ianaLocalYmdHmToUtcMs("2024-04-07", "00:00", tz)
    const endMs = ianaLocalYmdHmToUtcMs("2024-04-08", "00:00", tz)

    expect(new Date(startMs).toISOString()).toBe("2024-04-06T13:00:00.000Z")
    expect(new Date(endMs).toISOString()).toBe("2024-04-07T14:00:00.000Z")

    const wrongEndMs = localCalendarYmdHmToUtcMs("2024-04-08", "00:00", -660)
    expect(endMs).not.toBe(wrongEndMs)
    expect(endMs - startMs).toBe(25 * 60 * 60 * 1000)
  })

  it("uses distinct offsets on DST start day", () => {
    // 2024-10-06: clocks spring forward at 02:00 → Oct 6 00:00 is AEST, Oct 7 00:00 is AEDT
    const startMs = ianaLocalYmdHmToUtcMs("2024-10-06", "00:00", tz)
    const endMs = ianaLocalYmdHmToUtcMs("2024-10-07", "00:00", tz)

    expect(new Date(startMs).toISOString()).toBe("2024-10-05T14:00:00.000Z")
    expect(new Date(endMs).toISOString()).toBe("2024-10-06T13:00:00.000Z")
    expect(endMs - startMs).toBe(23 * 60 * 60 * 1000)
  })
})
