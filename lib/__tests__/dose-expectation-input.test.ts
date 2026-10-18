import { describe, it, expect } from "vitest"
import { validateDoseExpectationInput, parseLocalYmd } from "@/lib/schedule/dose-expectation-input"

const slots = ["08:00", "12:00", "18:30"]
const valid = { slot_hhmm: "12:00", start_date: "2025-01-13", end_date: "2025-03-28", weekdays: [1, 2, 3, 4, 5] }

describe("validateDoseExpectationInput", () => {
  it("accepts a slot in the schedule with a term range and weekdays", () => {
    expect(validateDoseExpectationInput(valid, slots)).toEqual({
      ok: true,
      value: { slotHhmm: "12:00", startDate: "2025-01-13", endDate: "2025-03-28", weekdays: [1, 2, 3, 4, 5] },
    })
  })

  it("normalises the slot time and defaults weekdays to every day", () => {
    expect(validateDoseExpectationInput({ ...valid, slot_hhmm: "1200", weekdays: undefined }, slots)).toEqual({
      ok: true,
      value: { slotHhmm: "12:00", startDate: "2025-01-13", endDate: "2025-03-28", weekdays: null },
    })
  })

  it("de-duplicates and sorts weekdays; all seven days means no filter", () => {
    const some = validateDoseExpectationInput({ ...valid, weekdays: [5, 1, 1, 3] }, slots)
    expect(some).toEqual(expect.objectContaining({ ok: true, value: expect.objectContaining({ weekdays: [1, 3, 5] }) }))
    const all = validateDoseExpectationInput({ ...valid, weekdays: [0, 1, 2, 3, 4, 5, 6] }, slots)
    expect(all).toEqual(expect.objectContaining({ ok: true, value: expect.objectContaining({ weekdays: null }) }))
  })

  it("requires the slot to be one of the schedule's dose times", () => {
    expect(validateDoseExpectationInput({ ...valid, slot_hhmm: "13:00" }, slots)).toEqual({
      ok: false,
      error: "slot_hhmm must be one of the scheduled dose times",
    })
  })

  it.each([
    [{ ...valid, start_date: "13/01/2025" }, "start_date must be a valid date (YYYY-MM-DD)"],
    [{ ...valid, end_date: "2025-02-30" }, "end_date must be a valid date (YYYY-MM-DD)"],
    [{ ...valid, start_date: "2025-04-01", end_date: "2025-03-01" }, "end_date must not be before start_date"],
    [{ ...valid, weekdays: [7] }, "weekdays must be whole numbers from 0 (Sunday) to 6 (Saturday)"],
    [{ ...valid, weekdays: "mon" }, "weekdays must be whole numbers from 0 (Sunday) to 6 (Saturday)"],
  ])("rejects %j", (input, error) => {
    expect(validateDoseExpectationInput(input, slots)).toEqual({ ok: false, error })
  })

  it("rejects a non-object body", () => {
    expect(validateDoseExpectationInput(null, slots)).toEqual({ ok: false, error: "Invalid body" })
  })
})

describe("parseLocalYmd", () => {
  it("accepts a real calendar date", () => {
    expect(parseLocalYmd("2025-02-03")).toBe("2025-02-03")
  })
  it("rejects anything else", () => {
    expect(parseLocalYmd("2025-02-30")).toBeNull()
    expect(parseLocalYmd("tomorrow")).toBeNull()
    expect(parseLocalYmd(20250203)).toBeNull()
  })
})
