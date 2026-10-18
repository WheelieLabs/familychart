import { describe, expect, it } from "vitest"
import { symptomStoredDateToYmd } from "@/lib/symptoms/symptom-dates"

describe("symptomStoredDateToYmd", () => {
  it("returns null for an absent or unreadable date", () => {
    expect(symptomStoredDateToYmd(null, null)).toBeNull()
    expect(symptomStoredDateToYmd("not a date", null)).toBeNull()
  })

  it("uses the instance timezone when there is one (local midnight in Adelaide is the previous day in UTC)", () => {
    expect(symptomStoredDateToYmd("2026-08-02T14:30:00.000Z", "Australia/Adelaide")).toBe("2026-08-03")
    expect(symptomStoredDateToYmd("2026-08-03T05:00:00.000Z", "America/New_York")).toBe("2026-08-03")
  })

  it("without a zone, recovers the day from the nearest UTC midnight for zones within 12 hours of UTC", () => {
    // Local midnight of 3 Aug in UTC+10:30, UTC, UTC-5 and UTC-11.
    expect(symptomStoredDateToYmd("2026-08-02T13:30:00.000Z", null)).toBe("2026-08-03")
    expect(symptomStoredDateToYmd("2026-08-03T00:00:00.000Z", null)).toBe("2026-08-03")
    expect(symptomStoredDateToYmd("2026-08-03T05:00:00.000Z", null)).toBe("2026-08-03")
    expect(symptomStoredDateToYmd("2026-08-03T11:00:00.000Z", null)).toBe("2026-08-03")
  })
})
