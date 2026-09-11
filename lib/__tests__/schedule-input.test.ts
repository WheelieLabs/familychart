import { describe, it, expect } from "vitest"
import {
  resolveTimesAndSlotsForPersonMedicationPost,
  resolveTimesAndSlotsForPersonMedicationPatch,
  validateMedicationScheduleInput,
} from "@/lib/schedule/schedule-input"

// ---------------------------------------------------------------------------
// resolveTimesAndSlotsForPersonMedicationPost
// ---------------------------------------------------------------------------

describe("resolveTimesAndSlotsForPersonMedicationPost", () => {
  it("returns empty times and slots when neither schedule_slots nor schedule_times is provided", () => {
    const result = resolveTimesAndSlotsForPersonMedicationPost({}, null)
    expect(result).toEqual({ times: [], slots: [] })
  })

  it("uses schedule_slots from body when present", () => {
    const body = { schedule_slots: [{ time: "08:00", dosage: 2 }, { time: "20:00", dosage: 1 }] }
    const { times, slots } = resolveTimesAndSlotsForPersonMedicationPost(body, null)
    expect(times).toEqual(["08:00", "20:00"])
    expect(slots).toEqual([{ time: "08:00", dosage: 2 }, { time: "20:00", dosage: 1 }])
  })

  it("uses schedule_times from body, applying fallback dosage", () => {
    const body = { schedule_times: ["08:00", "20:00"] }
    const { times, slots } = resolveTimesAndSlotsForPersonMedicationPost(body, 5)
    expect(times).toEqual(["08:00", "20:00"])
    expect(slots).toEqual([{ time: "08:00", dosage: 5 }, { time: "20:00", dosage: 5 }])
  })

  it("uses dosage 1 when schedule_times given and no default dosage", () => {
    const body = { schedule_times: ["08:00"] }
    const { slots } = resolveTimesAndSlotsForPersonMedicationPost(body, null)
    expect(slots[0]!.dosage).toBe(1)
  })

  it("schedule_slots takes priority over schedule_times when both present", () => {
    const body = {
      schedule_slots: [{ time: "08:00", dosage: 3 }],
      schedule_times: ["09:00", "21:00"],
    }
    const { times } = resolveTimesAndSlotsForPersonMedicationPost(body, null)
    expect(times).toEqual(["08:00"])
  })

  it("normalises time strings in schedule_times (single-digit hour)", () => {
    const body = { schedule_times: ["8:00"] }
    const { times } = resolveTimesAndSlotsForPersonMedicationPost(body, null)
    expect(times).toEqual(["08:00"])
  })

  it("throws for invalid time strings in schedule_times", () => {
    expect(() =>
      resolveTimesAndSlotsForPersonMedicationPost({ schedule_times: ["25:00"] }, null)
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// resolveTimesAndSlotsForPersonMedicationPatch
// ---------------------------------------------------------------------------

describe("resolveTimesAndSlotsForPersonMedicationPatch", () => {
  const storedTimesJson = '["08:00","20:00"]'
  const storedSlotsJson = '[{"time":"08:00","dosage":2},{"time":"20:00","dosage":1}]'

  it("returns stored data unchanged when body has neither schedule_slots nor schedule_times", () => {
    const { times, slots } = resolveTimesAndSlotsForPersonMedicationPatch(
      {}, storedTimesJson, storedSlotsJson, null
    )
    expect(times).toEqual(["08:00", "20:00"])
    expect(slots).toEqual([{ time: "08:00", dosage: 2 }, { time: "20:00", dosage: 1 }])
  })

  it("schedule_slots in body wins over stored data", () => {
    const body = { schedule_slots: [{ time: "12:00", dosage: 4 }] }
    const { times, slots } = resolveTimesAndSlotsForPersonMedicationPatch(
      body, storedTimesJson, storedSlotsJson, null
    )
    expect(times).toEqual(["12:00"])
    expect(slots).toEqual([{ time: "12:00", dosage: 4 }])
  })

  it("schedule_times in body wins over stored, merging dosages from stored slots", () => {
    // 08:00 has a stored dosage of 2; new time 14:00 gets the fallback
    const body = { schedule_times: ["08:00", "14:00"] }
    const { times, slots } = resolveTimesAndSlotsForPersonMedicationPatch(
      body, storedTimesJson, storedSlotsJson, 5
    )
    expect(times).toEqual(["08:00", "14:00"])
    const t08 = slots.find(s => s.time === "08:00")
    const t14 = slots.find(s => s.time === "14:00")
    expect(t08?.dosage).toBe(2) // preserved from stored slot
    expect(t14?.dosage).toBe(5) // fallback
  })

  it("schedule_slots in body wins over schedule_times in body", () => {
    const body = {
      schedule_slots: [{ time: "07:00", dosage: 1 }],
      schedule_times: ["08:00", "20:00"],
    }
    const { times } = resolveTimesAndSlotsForPersonMedicationPatch(
      body, storedTimesJson, storedSlotsJson, null
    )
    expect(times).toEqual(["07:00"])
  })

  it("falls back to fallback dosage for stored times that have no slot entry", () => {
    // stored times exist but stored slots is empty
    const { slots } = resolveTimesAndSlotsForPersonMedicationPatch(
      {}, storedTimesJson, null, 3
    )
    expect(slots.every(s => s.dosage === 3)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// validateMedicationScheduleInput
// ---------------------------------------------------------------------------

describe("validateMedicationScheduleInput", () => {
  it("returns all-null when times array is empty (schedule cleared)", () => {
    const result = validateMedicationScheduleInput([], null, null, null, null)
    expect(result).toEqual({ timesJson: null, slotsJson: null, frequencyJson: null, start: null, end: null })
  })

  it("throws when times are non-empty but no start date is provided", () => {
    const slots = [{ time: "08:00", dosage: 1 }]
    expect(() =>
      validateMedicationScheduleInput(["08:00"], null, null, null, slots)
    ).toThrow(/start_date/)
  })

  it("throws when twice_daily frequency has fewer than 2 times", () => {
    const slots = [{ time: "08:00", dosage: 1 }]
    expect(() =>
      validateMedicationScheduleInput(["08:00"], { kind: "twice_daily" }, "2025-01-01", null, slots)
    ).toThrow(/twice_daily/)
  })

  it("throws when twice_daily frequency has more than 2 times", () => {
    const slots = [
      { time: "08:00", dosage: 1 },
      { time: "14:00", dosage: 1 },
      { time: "20:00", dosage: 1 },
    ]
    expect(() =>
      validateMedicationScheduleInput(["08:00", "14:00", "20:00"], { kind: "twice_daily" }, "2025-01-01", null, slots)
    ).toThrow(/twice_daily/)
  })

  it("throws when end date is before start date", () => {
    const slots = [{ time: "08:00", dosage: 1 }]
    expect(() =>
      validateMedicationScheduleInput(["08:00"], null, "2025-06-01", "2025-01-01", slots)
    ).toThrow(/end_date/)
  })

  it("accepts end date equal to start date", () => {
    const slots = [{ time: "08:00", dosage: 1 }]
    expect(() =>
      validateMedicationScheduleInput(["08:00"], null, "2025-01-01", "2025-01-01", slots)
    ).not.toThrow()
  })

  it("returns correct JSON columns for a valid daily schedule", () => {
    const slots = [{ time: "08:00", dosage: 2 }, { time: "20:00", dosage: 1 }]
    const result = validateMedicationScheduleInput(
      ["08:00", "20:00"],
      { kind: "daily" },
      "2025-01-01",
      "2025-12-31",
      slots
    )
    expect(result.start).toBe("2025-01-01")
    expect(result.end).toBe("2025-12-31")
    expect(JSON.parse(result.timesJson!)).toEqual(["08:00", "20:00"])
    expect(JSON.parse(result.frequencyJson!)).toEqual({ kind: "daily" })
    expect(JSON.parse(result.slotsJson!)).toEqual(slots)
  })

  it("treats null end date as open-ended (end is null)", () => {
    const slots = [{ time: "08:00", dosage: 1 }]
    const result = validateMedicationScheduleInput(["08:00"], null, "2025-01-01", null, slots)
    expect(result.end).toBeNull()
  })
})
