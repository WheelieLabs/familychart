import { describe, it, expect } from "vitest"
import {
  derivePendingExpectations,
  expectationAppliesOnYmd,
  isFreshForPush,
  isSlotExternal,
  PUSH_FRESH_WINDOW_MS,
  type DoseExpectation,
  type ExpectationOutcome,
} from "@/lib/schedule/dose-expectation"
import type { SlotEvaluatorConfig } from "@/lib/schedule/schedule-slot-evaluator"

const MIN = 60_000
const cfg: SlotEvaluatorConfig = {
  leadMs: 30 * MIN,
  slotWindowMs: 30 * MIN,
  graceMs: 60 * MIN,
  overdueOffsetMs: 30 * MIN,
}

function exp(over: Partial<DoseExpectation> = {}): DoseExpectation {
  return {
    id: 1,
    personMedicationId: 10,
    slotHhmm: "12:00",
    startDate: "2025-01-13", // Monday
    endDate: "2025-03-28",
    weekdays: null,
    ...over,
  }
}

describe("expectationAppliesOnYmd", () => {
  it("applies inside the term range, inclusive of both ends", () => {
    expect(expectationAppliesOnYmd(exp(), new Set(), "2025-01-13")).toBe(true)
    expect(expectationAppliesOnYmd(exp(), new Set(), "2025-03-28")).toBe(true)
  })
  it("does not apply outside the range", () => {
    expect(expectationAppliesOnYmd(exp(), new Set(), "2025-01-12")).toBe(false)
    expect(expectationAppliesOnYmd(exp(), new Set(), "2025-03-29")).toBe(false)
  })
  it("honours the day-of-week filter (0 = Sunday)", () => {
    const weekdays = exp({ weekdays: [1, 2, 3, 4, 5] })
    expect(expectationAppliesOnYmd(weekdays, new Set(), "2025-01-15")).toBe(true) // Wed
    expect(expectationAppliesOnYmd(weekdays, new Set(), "2025-01-18")).toBe(false) // Sat
  })
  it("treats an empty weekday list as no filter", () => {
    expect(expectationAppliesOnYmd(exp({ weekdays: [] }), new Set(), "2025-01-18")).toBe(true)
  })
  it("skips one-off exception days", () => {
    expect(expectationAppliesOnYmd(exp(), new Set(["2025-01-15"]), "2025-01-15")).toBe(false)
  })
})

describe("isSlotExternal", () => {
  it("matches the person-medication and slot time on an applicable day", () => {
    const e = [exp()]
    expect(isSlotExternal(e, new Map(), 10, "12:00", "2025-01-15")).toBe(true)
  })
  it("does not match other slots, medications or days out of term", () => {
    const e = [exp()]
    expect(isSlotExternal(e, new Map(), 10, "08:00", "2025-01-15")).toBe(false)
    expect(isSlotExternal(e, new Map(), 11, "12:00", "2025-01-15")).toBe(false)
    expect(isSlotExternal(e, new Map(), 10, "12:00", "2025-04-02")).toBe(false)
  })
  it("respects exceptions", () => {
    expect(isSlotExternal([exp()], new Map([[1, new Set(["2025-01-15"])]]), 10, "12:00", "2025-01-15")).toBe(false)
  })
  it("supports several term ranges for the same slot", () => {
    const terms = [exp({ id: 1, endDate: "2025-03-28" }), exp({ id: 2, startDate: "2025-04-22", endDate: "2025-06-27" })]
    expect(isSlotExternal(terms, new Map(), 10, "12:00", "2025-05-01")).toBe(true)
    expect(isSlotExternal(terms, new Map(), 10, "12:00", "2025-04-10")).toBe(false)
  })
})

describe("derivePendingExpectations", () => {
  const today = "2025-01-15"
  const slotMs = Date.UTC(2025, 0, 15, 12, 0)
  const resolve = () => ({ ymd: today, slotMs })

  function pending(over: {
    expectations?: DoseExpectation[]
    outcomes?: ExpectationOutcome[]
    doseMs?: number[]
    nowMs?: number
    exceptions?: Map<number, Set<string>>
  }) {
    return derivePendingExpectations({
      expectations: over.expectations ?? [exp()],
      exceptionsByExpectation: over.exceptions ?? new Map(),
      outcomes: over.outcomes ?? [],
      doseMsFor: () => over.doseMs ?? [],
      resolve,
      nowMs: over.nowMs ?? slotMs + 10 * MIN,
      cfg,
    })
  }

  it("is pending once the slot time has passed", () => {
    expect(pending({})).toEqual([
      { expectationId: 1, personMedicationId: 10, ymd: today, hhmm: "12:00", slotMs },
    ])
  })

  it("is not pending before the slot time", () => {
    expect(pending({ nowMs: slotMs - MIN })).toEqual([])
  })

  it("stays pending later the same day", () => {
    expect(pending({ nowMs: slotMs + 6 * 60 * MIN })).toHaveLength(1)
  })

  it("is not pending when the day is outside the term or an exception", () => {
    expect(pending({ expectations: [exp({ endDate: "2025-01-10" })] })).toEqual([])
    expect(pending({ exceptions: new Map([[1, new Set([today])]]) })).toEqual([])
  })

  it("is cleared by a logged dose near the slot", () => {
    expect(pending({ doseMs: [slotMs + 20 * MIN] })).toEqual([])
  })

  it("is not cleared by a dose far from the slot", () => {
    expect(pending({ doseMs: [slotMs - 5 * 60 * MIN] })).toHaveLength(1)
  })

  it("is resolved by a confirmed outcome for today", () => {
    for (const status of ["confirmed_given", "confirmed_missed"] as const) {
      expect(
        pending({ outcomes: [{ expectationId: 1, localYmd: today, status, snoozedUntilMs: null }] }),
      ).toEqual([])
    }
  })

  it("ignores an outcome recorded for a different day", () => {
    expect(
      pending({ outcomes: [{ expectationId: 1, localYmd: "2025-01-14", status: "confirmed_given", snoozedUntilMs: null }] }),
    ).toHaveLength(1)
  })

  it("hides a snoozed prompt until the snooze ends, then shows it again", () => {
    const snoozed: ExpectationOutcome = {
      expectationId: 1,
      localYmd: today,
      status: "snoozed",
      snoozedUntilMs: slotMs + 70 * MIN,
    }
    expect(pending({ outcomes: [snoozed], nowMs: slotMs + 30 * MIN })).toEqual([])
    expect(pending({ outcomes: [snoozed], nowMs: slotMs + 80 * MIN })).toHaveLength(1)
  })

  it("skips an expectation whose calendar context can't be resolved", () => {
    expect(
      derivePendingExpectations({
        expectations: [exp()],
        exceptionsByExpectation: new Map(),
        outcomes: [],
        doseMsFor: () => [],
        resolve: () => null,
        nowMs: slotMs + MIN,
        cfg,
      }),
    ).toEqual([])
  })
})

describe("isFreshForPush", () => {
  const now = Date.parse("2025-01-15T12:00:00.000Z")

  it("allows a push while the slot is recent", () => {
    expect(isFreshForPush(now - 5 * MIN, now)).toBe(true)
    expect(isFreshForPush(now - PUSH_FRESH_WINDOW_MS, now)).toBe(true)
  })

  it("skips a slot that became pending long ago, e.g. after a restart", () => {
    expect(isFreshForPush(now - PUSH_FRESH_WINDOW_MS - MIN, now)).toBe(false)
  })
})
