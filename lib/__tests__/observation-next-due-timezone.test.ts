import { describe, expect, it } from "vitest"
import type { PersonObservationExpectationRow } from "@/lib/observation/observation-recurrence"
import { nextDueDisplay } from "@/lib/observation/observation-recurrence"

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

describe("nextDueDisplay row tz", () => {
  it("uses stored row tz instead of client offset when set", () => {
    const now = new Date("2024-06-14T22:00:00.000Z")
    const clientCtx = {
      now,
      tzOffsetMinutes: 0,
      localTodayYmd: "2024-06-14",
    }
    const sydneyDue = nextDueDisplay(
      "2024-06-14T10:00:00.000Z",
      baseRow({ tz: "Australia/Sydney", due_time_hhmm: "09:00" }),
      null,
      clientCtx,
      "Europe/London",
    )
    const londonDue = nextDueDisplay(
      "2024-06-14T10:00:00.000Z",
      baseRow({ tz: "Europe/London", due_time_hhmm: "09:00" }),
      null,
      clientCtx,
      "Australia/Sydney",
    )
    expect(sydneyDue?.toISOString()).toBe("2024-06-14T23:00:00.000Z")
    expect(londonDue?.toISOString()).toBe("2024-06-15T08:00:00.000Z")
    expect(sydneyDue?.toISOString()).not.toBe(londonDue?.toISOString())
  })

  it("falls back to instance tz when row tz is null", () => {
    const now = new Date("2024-06-14T22:00:00.000Z")
    const clientCtx = {
      now,
      tzOffsetMinutes: 0,
      localTodayYmd: "2024-06-14",
    }
    const due = nextDueDisplay(
      "2024-06-14T10:00:00.000Z",
      baseRow({ due_time_hhmm: "09:00" }),
      null,
      clientCtx,
      "Australia/Sydney",
    )
    expect(due?.toISOString()).toBe("2024-06-14T23:00:00.000Z")
  })
})
