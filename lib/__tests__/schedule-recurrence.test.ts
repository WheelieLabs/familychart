import { describe, it, expect } from "vitest"
import {
  parseScheduleTimesJson,
  parseScheduleSlotsJson,
  parseScheduleFrequencyJson,
  isScheduleActiveOnYmd,
  matchRecordToScheduledSlot,
  dosageForScheduledTime,
} from "@/lib/schedule/schedule-recurrence"
import type { MedScheduleFreq } from "@/lib/schedule/schedule-recurrence"

const daily: MedScheduleFreq = { kind: "daily" }
const twiceDaily: MedScheduleFreq = { kind: "twice_daily" }
const everyThreeDays: MedScheduleFreq = { kind: "every_n_days", n: 3 }
const monWedFri: MedScheduleFreq = { kind: "weekly", weekdays: [1, 3, 5] } // Mon=1, Wed=3, Fri=5

describe("parseScheduleTimesJson", () => {
  it("returns empty array for null", () => {
    expect(parseScheduleTimesJson(null)).toEqual([])
  })

  it("returns empty array for empty string", () => {
    expect(parseScheduleTimesJson("")).toEqual([])
  })

  it("parses a valid JSON array of time strings", () => {
    expect(parseScheduleTimesJson('["08:00","20:00"]')).toEqual(["08:00", "20:00"])
  })

  it("filters out non-string entries", () => {
    expect(parseScheduleTimesJson('["08:00", 1200, null]')).toEqual(["08:00"])
  })

  it("returns empty array for invalid JSON", () => {
    expect(parseScheduleTimesJson("not-json")).toEqual([])
  })
})

describe("parseScheduleSlotsJson", () => {
  it("returns empty array for null", () => {
    expect(parseScheduleSlotsJson(null)).toEqual([])
  })

  it("parses valid slot objects", () => {
    const slots = parseScheduleSlotsJson('[{"time":"08:00","dosage":2},{"time":"20:00","dosage":1}]')
    expect(slots).toEqual([
      { time: "08:00", dosage: 2 },
      { time: "20:00", dosage: 1 },
    ])
  })

  it("returns slots sorted by time", () => {
    const slots = parseScheduleSlotsJson('[{"time":"20:00","dosage":1},{"time":"08:00","dosage":2}]')
    expect(slots[0]!.time).toBe("08:00")
    expect(slots[1]!.time).toBe("20:00")
  })

  it("normalises time format (single-digit hours)", () => {
    const slots = parseScheduleSlotsJson('[{"time":"8:00","dosage":1}]')
    expect(slots[0]!.time).toBe("08:00")
  })

  it("deduplicates slots at the same time, keeping the last entry", () => {
    const slots = parseScheduleSlotsJson('[{"time":"08:00","dosage":1},{"time":"08:00","dosage":5}]')
    expect(slots).toHaveLength(1)
    expect(slots[0]!.dosage).toBe(5)
  })

  it("filters out entries with invalid or non-positive dosage", () => {
    const slots = parseScheduleSlotsJson('[{"time":"08:00","dosage":0},{"time":"20:00","dosage":-1}]')
    expect(slots).toHaveLength(0)
  })

  it("filters out entries with invalid time strings", () => {
    const slots = parseScheduleSlotsJson('[{"time":"25:00","dosage":1}]')
    expect(slots).toHaveLength(0)
  })
})

describe("parseScheduleFrequencyJson", () => {
  it("parses daily", () => {
    expect(parseScheduleFrequencyJson('{"kind":"daily"}')).toEqual({ kind: "daily" })
  })

  it("parses twice_daily", () => {
    expect(parseScheduleFrequencyJson('{"kind":"twice_daily"}')).toEqual({ kind: "twice_daily" })
  })

  it("parses every_n_days", () => {
    expect(parseScheduleFrequencyJson('{"kind":"every_n_days","n":3}')).toEqual({ kind: "every_n_days", n: 3 })
  })

  it("throws for every_n_days with n < 2", () => {
    expect(() => parseScheduleFrequencyJson('{"kind":"every_n_days","n":1}')).toThrow()
  })

  it("parses weekly with sorted deduplicated weekdays", () => {
    expect(parseScheduleFrequencyJson('{"kind":"weekly","weekdays":[3,1,1,5]}')).toEqual({
      kind: "weekly",
      weekdays: [1, 3, 5],
    })
  })

  it("throws for weekly with empty weekdays", () => {
    expect(() => parseScheduleFrequencyJson('{"kind":"weekly","weekdays":[]}')).toThrow()
  })

  it("returns null for null input", () => {
    expect(parseScheduleFrequencyJson(null)).toBeNull()
  })
})

describe("isScheduleActiveOnYmd — daily", () => {
  it("is active on the start date", () => {
    expect(isScheduleActiveOnYmd(daily, "2025-01-01", null, "2025-01-01")).toBe(true)
  })

  it("is active after the start date", () => {
    expect(isScheduleActiveOnYmd(daily, "2025-01-01", null, "2025-03-15")).toBe(true)
  })

  it("is inactive before the start date", () => {
    expect(isScheduleActiveOnYmd(daily, "2025-01-15", null, "2025-01-01")).toBe(false)
  })

  it("is inactive after the end date", () => {
    expect(isScheduleActiveOnYmd(daily, "2025-01-01", "2025-01-31", "2025-02-01")).toBe(false)
  })

  it("is active on the end date itself", () => {
    expect(isScheduleActiveOnYmd(daily, "2025-01-01", "2025-01-31", "2025-01-31")).toBe(true)
  })

  it("twice_daily behaves the same as daily for date filtering", () => {
    expect(isScheduleActiveOnYmd(twiceDaily, "2025-01-01", null, "2025-01-10")).toBe(true)
    expect(isScheduleActiveOnYmd(twiceDaily, "2025-01-15", null, "2025-01-01")).toBe(false)
  })

  it("returns false when freq is null", () => {
    expect(isScheduleActiveOnYmd(null, "2025-01-01", null, "2025-01-10")).toBe(false)
  })
})

describe("isScheduleActiveOnYmd — weekly", () => {
  // monWedFri = weekdays [1, 3, 5] (Mon, Wed, Fri)
  // 2025-01-13 = Monday, 2025-01-14 = Tuesday, 2025-01-15 = Wednesday

  it("is active on a matching weekday", () => {
    expect(isScheduleActiveOnYmd(monWedFri, "2025-01-01", null, "2025-01-13")).toBe(true) // Monday
  })

  it("is inactive on a non-matching weekday", () => {
    expect(isScheduleActiveOnYmd(monWedFri, "2025-01-01", null, "2025-01-14")).toBe(false) // Tuesday
  })

  it("is inactive before the start date even on a matching weekday", () => {
    expect(isScheduleActiveOnYmd(monWedFri, "2025-01-20", null, "2025-01-13")).toBe(false)
  })
})

describe("isScheduleActiveOnYmd — every_n_days", () => {
  // Start 2025-01-01, every 3 days → active on Jan 1, 4, 7, 10, 13 ...

  it("is active on the start date (day 0)", () => {
    expect(isScheduleActiveOnYmd(everyThreeDays, "2025-01-01", null, "2025-01-01")).toBe(true)
  })

  it("is active on day n (Jan 4 = day 3)", () => {
    expect(isScheduleActiveOnYmd(everyThreeDays, "2025-01-01", null, "2025-01-04")).toBe(true)
  })

  it("is inactive on day 1", () => {
    expect(isScheduleActiveOnYmd(everyThreeDays, "2025-01-01", null, "2025-01-02")).toBe(false)
  })

  it("is inactive on day 2", () => {
    expect(isScheduleActiveOnYmd(everyThreeDays, "2025-01-01", null, "2025-01-03")).toBe(false)
  })

  it("is active on day 2n (Jan 7 = day 6)", () => {
    expect(isScheduleActiveOnYmd(everyThreeDays, "2025-01-01", null, "2025-01-07")).toBe(true)
  })
})

describe("dosageForScheduledTime", () => {
  const slotsJson = '[{"time":"08:00","dosage":2},{"time":"20:00","dosage":1}]'

  it("returns the dosage for a matching slot", () => {
    expect(dosageForScheduledTime("08:00", slotsJson, null)).toBe(2)
  })

  it("returns fallbackDosage when the time does not match any slot", () => {
    expect(dosageForScheduledTime("12:00", slotsJson, 3)).toBe(3)
  })

  it("returns 1 when there is no match and no fallback", () => {
    expect(dosageForScheduledTime("12:00", slotsJson, null)).toBe(1)
  })

  it("returns 1 when slotsJson is null and no fallback", () => {
    expect(dosageForScheduledTime("08:00", null, null)).toBe(1)
  })

  it("returns fallbackDosage when slotsJson is null", () => {
    expect(dosageForScheduledTime("08:00", null, 5)).toBe(5)
  })
})

describe("matchRecordToScheduledSlot", () => {
  const daily: MedScheduleFreq = { kind: "daily" }

  it("matches using client offset calendar, not server-local midnight", () => {
    // Sydney (UTC+10): offset -600. 21:30 UTC on 15 Jan is 08:30 on 16 Jan local.
    const recordedAt = new Date("2025-01-15T22:35:00.000Z")
    const match = matchRecordToScheduledSlot(
      recordedAt,
      ["08:00", "20:00"],
      daily,
      "2025-01-01",
      null,
      -600,
    )
    expect(match).toEqual({ slotTimeLabel: "08:00", late: true })
  })

  it("returns null when local calendar day is outside schedule", () => {
    const recordedAt = new Date("2025-01-15T21:30:00.000Z")
    const match = matchRecordToScheduledSlot(
      recordedAt,
      ["08:00"],
      daily,
      "2025-02-01",
      null,
      -600,
    )
    expect(match).toBeNull()
  })
})
