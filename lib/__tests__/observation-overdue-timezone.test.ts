import { describe, expect, it } from "vitest"
import type { PersonObservationExpectationRow } from "@/lib/observation/observation-recurrence"
import { isObservationOverdue } from "@/lib/observation/observation-recurrence"

function baseRow(overrides: Partial<PersonObservationExpectationRow> = {}): PersonObservationExpectationRow {
  return {
    id: 1,
    person_id: 1,
    observation_type: "Weight",
    cadence: "daily",
    interval_days: null,
    recurrence_day_of_month: null,
    recurrence_month: null,
    recurrence_day: null,
    recurrence_use_birthday: 0,
    enabled: 1,
    due_time_hhmm: "09:00",
    tz: null,
    ...overrides,
  }
}

describe("isObservationOverdue Layer C fallback", () => {
  it("returns false when row tz and instance tz are both absent", () => {
    const now = new Date("2024-06-15T12:00:00.000Z")
    expect(isObservationOverdue(null, baseRow(), null, now)).toBe(false)
    expect(isObservationOverdue(null, baseRow(), null, now, null)).toBe(false)
  })

  it("uses instance tz when row tz is null", () => {
    const now = new Date("2024-06-15T01:00:00.000Z")
    expect(isObservationOverdue(null, baseRow({ due_time_hhmm: "09:00" }), null, now, "Australia/Sydney")).toBe(
      true,
    )
  })

  it("prefers row tz over instance tz", () => {
    const last = "2024-06-14T10:00:00.000Z"
    const now = new Date("2024-06-15T01:00:00.000Z")
    const overdueSydney = isObservationOverdue(
      last,
      baseRow({ tz: "Australia/Sydney", due_time_hhmm: "09:00" }),
      null,
      now,
      "Europe/London",
    )
    const notOverdueLondon = isObservationOverdue(
      last,
      baseRow({ tz: "Europe/London", due_time_hhmm: "09:00" }),
      null,
      now,
      "Australia/Sydney",
    )
    expect(overdueSydney).toBe(true)
    expect(notOverdueLondon).toBe(false)
  })
})
