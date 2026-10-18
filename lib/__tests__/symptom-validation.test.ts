import { describe, expect, it } from "vitest"
import { validateSymptomEventWrite } from "@/lib/symptoms/symptom-validation"

describe("validateSymptomEventWrite", () => {
  it("accepts a well-formed symptom event with no end date", () => {
    const result = validateSymptomEventWrite({
      label: "Runny nose",
      start_date: "2026-08-01T09:00:00.000Z",
      severity: 2,
    })
    expect(result).toEqual({
      ok: true,
      label: "Runny nose",
      startDate: "2026-08-01T09:00:00.000Z",
      endDate: null,
      severity: 2,
      isResolved: false,
      notes: null,
    })
  })

  it("accepts an end date on or after the start date", () => {
    const result = validateSymptomEventWrite({
      label: "Cough",
      start_date: "2026-08-01T09:00:00.000Z",
      end_date: "2026-08-03T09:00:00.000Z",
      severity: 3,
      is_resolved: true,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.endDate).toBe("2026-08-03T09:00:00.000Z")
      expect(result.isResolved).toBe(true)
    }
  })

  it("rejects a missing label", () => {
    const result = validateSymptomEventWrite({ label: "  ", start_date: "2026-08-01T09:00:00.000Z", severity: 1 })
    expect(result.ok).toBe(false)
  })

  it("rejects an invalid start_date", () => {
    const result = validateSymptomEventWrite({ label: "Cough", start_date: "not-a-date", severity: 1 })
    expect(result.ok).toBe(false)
  })

  it("rejects an end_date before the start_date", () => {
    const result = validateSymptomEventWrite({
      label: "Cough",
      start_date: "2026-08-03T09:00:00.000Z",
      end_date: "2026-08-01T09:00:00.000Z",
      severity: 1,
    })
    expect(result.ok).toBe(false)
  })

  it("rejects an invalid end_date", () => {
    const result = validateSymptomEventWrite({
      label: "Cough",
      start_date: "2026-08-01T09:00:00.000Z",
      end_date: "not-a-date",
      severity: 1,
    })
    expect(result.ok).toBe(false)
  })

  it.each([0, 6, 1.5, NaN])("rejects an out-of-range or non-integer severity (%s)", severity => {
    const result = validateSymptomEventWrite({ label: "Cough", start_date: "2026-08-01T09:00:00.000Z", severity })
    expect(result.ok).toBe(false)
  })

  it("accepts a numeric-string severity", () => {
    const result = validateSymptomEventWrite({ label: "Cough", start_date: "2026-08-01T09:00:00.000Z", severity: "4" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.severity).toBe(4)
  })

  it("defaults is_resolved to false when absent", () => {
    const result = validateSymptomEventWrite({ label: "Cough", start_date: "2026-08-01T09:00:00.000Z", severity: 1 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.isResolved).toBe(false)
  })

  it("trims notes and treats blank notes as none", () => {
    const base = { label: "Cough", start_date: "2026-08-01T09:00:00.000Z", severity: 2 }
    const withNotes = validateSymptomEventWrite({ ...base, notes: "  worse at night  " })
    expect(withNotes.ok && withNotes.notes).toBe("worse at night")
    const blank = validateSymptomEventWrite({ ...base, notes: "   " })
    expect(blank.ok && blank.notes).toBeNull()
  })
})
