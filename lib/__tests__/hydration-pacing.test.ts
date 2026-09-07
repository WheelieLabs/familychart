import { describe, it, expect } from "vitest"
import { computeHydrationPacing } from "@/lib/hydration/hydration-pacing"

/** 07:00–21:00 active window (840 minutes). */
const START = 7 * 60
const END = 21 * 60
const GLASS = 250
const TARGET = 2000

function pace(overrides: Partial<Parameters<typeof computeHydrationPacing>[0]> = {}) {
  return computeHydrationPacing({
    activeStart: START,
    activeEnd: END,
    glassSize: GLASS,
    target: TARGET,
    consumed: 0,
    nowLocalMinutes: START,
    ...overrides,
  })
}

describe("computeHydrationPacing", () => {
  it("returns before_window with no deficit before active hours", () => {
    const result = pace({ nowLocalMinutes: START - 30, consumed: 100 })
    expect(result.status).toBe("before_window")
    expect(result.deficit).toBe(0)
    expect(result.glassesNeededNow).toBeNull()
  })

  it("returns on_pace when consumption meets the linear expectation", () => {
    const noon = 12 * 60
    const elapsedHours = (noon - START) / 60
    const totalHours = (END - START) / 60
    const expected = TARGET * (elapsedHours / totalHours)
    const result = pace({ nowLocalMinutes: noon, consumed: expected })
    expect(result.status).toBe("on_pace")
    expect(result.deficit).toBe(0)
    expect(result.glassesNeededNow).toBeNull()
  })

  it("returns on_pace (not behind) when consumed equals expectedByNow exactly", () => {
    const mid = START + (END - START) / 2
    const expected = TARGET / 2
    const result = pace({ nowLocalMinutes: mid, consumed: expected })
    expect(result.status).toBe("on_pace")
  })

  it("returns behind with catch-up glasses when pace is short and time remains", () => {
    const noon = 12 * 60
    const result = pace({ nowLocalMinutes: noon, consumed: 200 })
    expect(result.status).toBe("behind")
    expect(result.deficit).toBeGreaterThan(0)
    expect(result.glassesNeededNow).toBe(Math.ceil(result.deficit / GLASS))
    expect(result.catchUpRealistic).toBe(true)
    expect(result.requiredRate).toBeGreaterThan(0)
  })

  it("returns behind with catchUpRealistic false in the final 30 minutes", () => {
    const almostEnd = END - 20
    const result = pace({ nowLocalMinutes: almostEnd, consumed: 500 })
    expect(result.status).toBe("behind")
    expect(result.catchUpRealistic).toBe(false)
    expect(result.requiredRate).toBeNull()
    expect(result.glassesNeededNow).toBeGreaterThan(0)
  })

  it("computes requiredRate at exactly 0.5 remaining hours", () => {
    const halfHourBeforeEnd = END - 30
    const result = pace({ nowLocalMinutes: halfHourBeforeEnd, consumed: 500 })
    expect(result.status).toBe("behind")
    expect(result.catchUpRealistic).toBe(true)
    expect(result.requiredRate).toBe((TARGET - 500) / 0.5)
  })

  it("returns window_closed when the active window has ended without meeting the goal", () => {
    const result = pace({ nowLocalMinutes: END, consumed: 1500 })
    expect(result.status).toBe("window_closed")
    expect(result.deficit).toBe(TARGET - 1500)
    expect(result.glassesNeededNow).toBeNull()
    expect(result.catchUpRealistic).toBe(false)
    expect(result.requiredRate).toBeUndefined()
  })

  it("returns met when the goal is reached", () => {
    const result = pace({ nowLocalMinutes: 10 * 60, consumed: TARGET })
    expect(result.status).toBe("met")
    expect(result.deficit).toBe(0)
    expect(result.glassesRemainingTotal).toBe(0)
    expect(result.glassesNeededNow).toBeNull()
  })

  it("returns met via overshoot without warning fields", () => {
    const result = pace({ nowLocalMinutes: 10 * 60, consumed: TARGET + 500 })
    expect(result.status).toBe("met")
    expect(result.deficit).toBe(0)
  })

  it("degrades a 24h flat window to calendar-day linear pacing", () => {
    const flatStart = 0
    const flatEnd = 24 * 60
    const noon = 12 * 60
    const result = computeHydrationPacing({
      activeStart: flatStart,
      activeEnd: flatEnd,
      glassSize: GLASS,
      target: TARGET,
      consumed: TARGET / 2,
      nowLocalMinutes: noon,
    })
    expect(result.status).toBe("on_pace")
    expect(result.deficit).toBe(0)
  })

  it("reports glassesRemainingTotal from volume left to goal", () => {
    const result = pace({ nowLocalMinutes: 10 * 60, consumed: 750 })
    expect(result.glassesRemainingTotal).toBe(Math.ceil((TARGET - 750) / GLASS))
  })
})
