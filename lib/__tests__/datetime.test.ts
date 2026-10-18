import { describe, it, expect } from "vitest"
import {
  addCalendarDaysToIsoYmd,
  dayQualifierForYmd,
  deviceZoneDiffersFrom,
  ianaLocalYmdHmToUtcMs,
  instantToZonedYmdHm,
  localCalendarYmdHmToUtcMs,
  localDateAndTimeToUtcIso,
  localDateToIsoYmd,
  sqliteUtcToIso,
  zonedTodayYmd,
} from "@/lib/datetime"
import { setDisplayTimeZone } from "@/lib/display-time-zone"

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

describe("entry in the instance timezone", () => {
  it("reads a typed date and time in the given zone, whatever the device zone is", () => {
    expect(localDateAndTimeToUtcIso("2026-10-09", "23:03", "Australia/Sydney")).toBe("2026-10-09T12:03:00.000Z")
    expect(localDateAndTimeToUtcIso("2026-10-09", "23:03", "Europe/London")).toBe("2026-10-09T22:03:00.000Z")
    expect(localDateAndTimeToUtcIso("2026-01-09", "23:03", "America/New_York")).toBe("2026-01-10T04:03:00.000Z")
  })

  it("defaults to the display timezone", () => {
    setDisplayTimeZone("Australia/Perth")
    try {
      expect(localDateAndTimeToUtcIso("2026-10-09", "08:00")).toBe("2026-10-09T00:00:00.000Z")
    } finally {
      setDisplayTimeZone("UTC")
    }
  })

  it("uses the offset in force on the day across a spring-forward edge", () => {
    expect(localDateAndTimeToUtcIso("2026-10-03", "12:00", "Australia/Sydney")).toBe("2026-10-03T02:00:00.000Z")
    expect(localDateAndTimeToUtcIso("2026-10-05", "12:00", "Australia/Sydney")).toBe("2026-10-05T01:00:00.000Z")
  })

  it("resolves a time inside the spring-forward gap to a real instant that reads back after the gap", () => {
    const iso = localDateAndTimeToUtcIso("2026-10-04", "02:30", "Australia/Sydney")
    const back = instantToZonedYmdHm(iso, "Australia/Sydney")
    expect(back.date).toBe("2026-10-04")
    expect(["03:30", "01:30"]).toContain(back.time)
  })

  it("takes the first occurrence of a repeated autumn time", () => {
    const iso = localDateAndTimeToUtcIso("2026-04-05", "02:30", "Australia/Sydney")
    expect(["2026-04-04T15:30:00.000Z", "2026-04-04T16:30:00.000Z"]).toContain(iso)
    expect(instantToZonedYmdHm(iso, "Australia/Sydney")).toEqual({ date: "2026-04-05", time: "02:30" })
  })

  it("rejects an invalid date or time", () => {
    expect(() => localDateAndTimeToUtcIso("not-a-date", "12:00", "UTC")).toThrow()
    expect(() => localDateAndTimeToUtcIso("2026-10-09", "25:00", "UTC")).toThrow()
  })
})

describe("display of an instant on the instance wall clock", () => {
  it("round-trips with entry", () => {
    for (const tz of ["Australia/Sydney", "Europe/London", "America/Los_Angeles", "Asia/Kolkata"]) {
      const iso = localDateAndTimeToUtcIso("2026-07-15", "07:05", tz)
      expect(instantToZonedYmdHm(iso, tz)).toEqual({ date: "2026-07-15", time: "07:05" })
    }
  })

  it("can move the calendar day relative to UTC", () => {
    expect(instantToZonedYmdHm("2026-10-09T15:30:00.000Z", "Australia/Sydney")).toEqual({ date: "2026-10-10", time: "02:30" })
  })

  it("gives today in the zone, not the device", () => {
    const now = Date.parse("2026-10-09T15:30:00Z")
    expect(zonedTodayYmd(now, "Australia/Sydney")).toBe("2026-10-10")
    expect(zonedTodayYmd(now, "America/Los_Angeles")).toBe("2026-10-09")
  })
})

describe("deviceZoneDiffersFrom", () => {
  it("compares the device offset with the zone's offset at that instant", () => {
    const now = Date.parse("2026-10-09T12:00:00Z")
    const deviceOffset = new Date(now).getTimezoneOffset()
    expect(deviceZoneDiffersFrom("UTC", now)).toBe(deviceOffset !== 0)
    expect(deviceZoneDiffersFrom("Pacific/Kiritimati", now)).toBe(deviceOffset !== -840)
  })
})

describe("sqliteUtcToIso", () => {
  it("reads a CURRENT_TIMESTAMP value as UTC, not in the device's zone", () => {
    expect(sqliteUtcToIso("2026-10-09 12:30:05")).toBe("2026-10-09T12:30:05Z")
    expect(new Date(sqliteUtcToIso("2026-10-09 12:30:05")).toISOString()).toBe("2026-10-09T12:30:05.000Z")
  })

  it("leaves an ISO instant alone", () => {
    expect(sqliteUtcToIso("2026-10-09T12:30:05.000Z")).toBe("2026-10-09T12:30:05.000Z")
  })
})
