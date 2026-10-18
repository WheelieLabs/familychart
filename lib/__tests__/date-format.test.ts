import { afterEach, describe, expect, it } from "vitest"
import {
  formatDate,
  formatDateLong,
  formatDateShort,
  formatDateTimeLong,
  formatDateTime,
  formatDobWithAge,
  formatElapsed,
  formatMonthYear,
  formatRange,
  formatTime,
  formatWeekdayDate,
  getDisplayLocale,
  getDisplayTimeZone,
  setDisplayTimeZone,
} from "@/lib/date-format"

const LONDON = { timeZone: "Europe/London" }
// 18:46 UTC is 19:46 in London (BST).
const EVENING = "2026-10-09T18:46:00Z"
const LATE = "2026-10-09T21:47:00Z"

afterEach(() => setDisplayTimeZone("UTC"))

describe("date-format", () => {
  it("uses a constant locale, never the runtime's", () => {
    expect(getDisplayLocale()).toBe("en-AU")
  })

  it("formats a date", () => {
    expect(formatDate(EVENING, LONDON)).toBe("9 Oct 2026")
    expect(formatDate("2026-01-05")).toBe("5 Jan 2026")
  })

  it("never shifts a bare calendar date by the display zone", () => {
    expect(formatDate("2026-10-09", { timeZone: "Pacific/Auckland" })).toBe("9 Oct 2026")
    expect(formatDate("2026-10-09", { timeZone: "America/Los_Angeles" })).toBe("9 Oct 2026")
  })

  it("applies the display zone to an instant", () => {
    const instant = "2026-10-09T23:30:00Z"
    expect(formatDate(instant, { timeZone: "UTC" })).toBe("9 Oct 2026")
    expect(formatDate(instant, { timeZone: "Australia/Sydney" })).toBe("10 Oct 2026")
  })

  it("falls back to the display zone set from the instance", () => {
    setDisplayTimeZone("Australia/Sydney")
    expect(getDisplayTimeZone()).toBe("Australia/Sydney")
    expect(formatDate("2026-10-09T23:30:00Z")).toBe("10 Oct 2026")
  })

  it("formats a short date in the same year, and the full date otherwise", () => {
    const now = "2026-10-09T12:00:00Z"
    expect(formatDateShort("2026-03-02T12:00:00Z", { now })).toBe("2 Mar")
    expect(formatDateShort("2025-03-02T12:00:00Z", { now })).toBe("2 Mar 2025")
  })

  it("formats a weekday and date without a comma", () => {
    expect(formatWeekdayDate(EVENING, LONDON)).toBe("Fri 9 Oct")
  })

  it("formats a lowercase time with an ordinary space", () => {
    const time = formatTime(EVENING, LONDON)
    expect(time).toBe("7:46 pm")
    expect(time).not.toMatch(/[  ]/)
    expect(formatTime("2026-10-09T00:05:00Z", { timeZone: "UTC" })).toBe("12:05 am")
  })

  it("formats a date and time, with seconds for the Audit Log", () => {
    expect(formatDateTime(EVENING, LONDON)).toBe("9 Oct 2026, 7:46 pm")
    expect(formatDateTime(LATE, { ...LONDON, seconds: true })).toBe("9 Oct 2026, 10:47:00 pm")
  })

  it("spells a date and a date and time out in full", () => {
    expect(formatDateLong("2026-10-09")).toBe("Friday 9 October 2026")
    expect(formatDateTimeLong("2026-10-09T22:03:00Z", { timeZone: "Europe/London" })).toBe("Friday 9 October 2026, 11:03 pm")
  })

  it("names a month for the calendar heading", () => {
    expect(formatMonthYear("2026-09")).toBe("September 2026")
    expect(formatMonthYear("2026-12-31")).toBe("December 2026")
  })

  it("formats a range, adding the year to each end when they differ", () => {
    expect(formatRange("2026-10-02", "2026-10-09")).toBe("2 Oct – 9 Oct 2026")
    expect(formatRange("2025-12-30", "2026-01-02")).toBe("30 Dec 2025 – 2 Jan 2026")
  })

  it("formats a date of birth with age", () => {
    const now = "2026-10-09T12:00:00Z"
    expect(formatDobWithAge("2015-04-02", { now })).toBe("2 Apr 2015 · 11 yrs")
    expect(formatDobWithAge("2025-04-02", { now })).toBe("2 Apr 2025 · 1 yr")
  })

  it("returns an empty string for an invalid date", () => {
    expect(formatDate("not a date")).toBe("")
    expect(formatDateTime("not a date")).toBe("")
    expect(formatWeekdayDate("not a date")).toBe("")
  })

  describe("formatElapsed", () => {
    const now = Date.parse("2026-10-09T12:00:00Z")
    const ago = (seconds: number) => formatElapsed(now - seconds * 1000, { now })

    it("keeps the existing past scale", () => {
      expect(ago(10)).toBe("just now")
      expect(ago(60)).toBe("1 min ago")
      expect(ago(15 * 60)).toBe("15 min ago")
      expect(ago(4000)).toBe("1 hour ago")
      expect(ago(3 * 3600)).toBe("3 hours ago")
      expect(ago(30 * 3600)).toBe("yesterday")
      expect(ago(5 * 86400)).toBe("5 days ago")
    })

    it("falls back to the date after 30 days", () => {
      expect(ago(40 * 86400)).toBe("30 Aug 2026")
    })

    it("reads a future instant as remaining time", () => {
      expect(formatElapsed(now + 40 * 60_000, { now })).toBe("in 40 min")
      expect(formatElapsed(now + (3 * 60 + 20) * 60_000, { now })).toBe("in 3 h 20 min")
      expect(formatElapsed(now + 2 * 3600_000, { now })).toBe("in 2 h")
    })
  })
})
