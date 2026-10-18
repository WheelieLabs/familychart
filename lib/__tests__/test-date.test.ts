import { describe, expect, it } from "vitest"
import { testDateToStoredIso, isFutureTestDate } from "@/lib/test-results/test-date"

const TZ = "Australia/Sydney"
// 2026-08-10 09:30 in Sydney (UTC+10)
const MORNING = new Date("2026-08-09T23:30:00Z")
const AFTERNOON = new Date("2026-08-10T05:00:00Z")

describe("testDateToStoredIso", () => {
  it("stores a past date at midday in the instance timezone", () => {
    expect(testDateToStoredIso("2026-08-05", MORNING, TZ)).toBe("2026-08-05T02:00:00.000Z")
  })

  it("never lands in the future: today before midday clamps to now", () => {
    expect(testDateToStoredIso("2026-08-10", MORNING, TZ)).toBe(MORNING.toISOString())
  })

  it("keeps midday when today's midday has already passed", () => {
    expect(testDateToStoredIso("2026-08-10", AFTERNOON, TZ)).toBe("2026-08-10T02:00:00.000Z")
  })
})

describe("isFutureTestDate", () => {
  it("is true only for a calendar day after today in the instance timezone", () => {
    expect(isFutureTestDate("2026-08-11", MORNING, TZ)).toBe(true)
    expect(isFutureTestDate("2026-08-10", MORNING, TZ)).toBe(false)
    expect(isFutureTestDate("2026-08-09", MORNING, TZ)).toBe(false)
    expect(isFutureTestDate("", MORNING, TZ)).toBe(false)
  })

  it("follows the zone, not the instant's UTC date", () => {
    expect(isFutureTestDate("2026-08-10", MORNING, "America/Los_Angeles")).toBe(true)
  })
})
