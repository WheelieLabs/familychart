import { describe, it, expect } from "vitest"
import {
  HYDRATION_NUDGE_CADENCE_ESCALATED_MIN,
  HYDRATION_NUDGE_CADENCE_NORMAL_MIN,
  HYDRATION_NUDGE_ESCALATION_MULTIPLIER,
  computeEvenPaceBaselineMlPerHour,
  evaluateHydrationNudge,
  hydrationNudgeCadenceMinutes,
  isHydrationNudgeEscalated,
} from "@/lib/hydration/hydration-nudge-decision"

const START = 7 * 60
const END = 21 * 60
const TARGET = 2000
const NOW_MS = 1_700_000_000_000

function baseInput(
  overrides: Partial<Parameters<typeof evaluateHydrationNudge>[0]> = {},
): Parameters<typeof evaluateHydrationNudge>[0] {
  return {
    isUser: true,
    pacingStatus: "behind",
    activeStartMin: START,
    activeEndMin: END,
    nowLocalMinutes: 12 * 60,
    glassesNeededNow: 3,
    requiredRate: 200,
    targetMl: TARGET,
    lastNudgeAtMs: null,
    lastRecordAtMs: null,
    nowMs: NOW_MS,
    ...overrides,
  }
}

describe("computeEvenPaceBaselineMlPerHour", () => {
  it("returns target divided by total active hours", () => {
    expect(computeEvenPaceBaselineMlPerHour(TARGET, START, END)).toBeCloseTo(2000 / 14)
  })
})

describe("isHydrationNudgeEscalated", () => {
  const baseline = computeEvenPaceBaselineMlPerHour(TARGET, START, END)

  it("flips when requiredRate exceeds baseline * M", () => {
    const threshold = baseline * HYDRATION_NUDGE_ESCALATION_MULTIPLIER
    expect(isHydrationNudgeEscalated(threshold + 1, baseline)).toBe(true)
    expect(isHydrationNudgeEscalated(threshold, baseline)).toBe(false)
    expect(isHydrationNudgeEscalated(threshold - 1, baseline)).toBe(false)
  })

  it("returns false when requiredRate is null", () => {
    expect(isHydrationNudgeEscalated(null, baseline)).toBe(false)
  })
})

describe("hydrationNudgeCadenceMinutes", () => {
  it("uses 60 min normal and 30 min escalated (never below 30)", () => {
    expect(hydrationNudgeCadenceMinutes(false)).toBe(HYDRATION_NUDGE_CADENCE_NORMAL_MIN)
    expect(hydrationNudgeCadenceMinutes(true)).toBe(HYDRATION_NUDGE_CADENCE_ESCALATED_MIN)
    expect(HYDRATION_NUDGE_CADENCE_ESCALATED_MIN).toBeGreaterThanOrEqual(30)
  })
})

describe("evaluateHydrationNudge cadence gate", () => {
  it("fires at >=60 min since last nudge (normal)", () => {
    const at59 = evaluateHydrationNudge(
      baseInput({ requiredRate: 100, lastNudgeAtMs: NOW_MS - 59 * 60_000 }),
    )
    const at60 = evaluateHydrationNudge(
      baseInput({ requiredRate: 100, lastNudgeAtMs: NOW_MS - 60 * 60_000 }),
    )
    expect(at59.eligible).toBe(false)
    expect(at59.reason).toBe("cadence_gate")
    expect(at59.cadenceMinutes).toBe(60)
    expect(at60.eligible).toBe(true)
  })

  it("fires at >=30 min when escalated", () => {
    const baseline = computeEvenPaceBaselineMlPerHour(TARGET, START, END)
    const escalatedRate = baseline * HYDRATION_NUDGE_ESCALATION_MULTIPLIER + 50

    const at29 = evaluateHydrationNudge(
      baseInput({ requiredRate: escalatedRate, lastNudgeAtMs: NOW_MS - 29 * 60_000 }),
    )
    const at30 = evaluateHydrationNudge(
      baseInput({ requiredRate: escalatedRate, lastNudgeAtMs: NOW_MS - 30 * 60_000 }),
    )
    expect(at29.eligible).toBe(false)
    expect(at29.cadenceMinutes).toBe(30)
    expect(at30.eligible).toBe(true)
    expect(at30.escalated).toBe(true)
  })

  it("allows first nudge when lastNudgeAt is missing", () => {
    expect(evaluateHydrationNudge(baseInput({ lastNudgeAtMs: null })).eligible).toBe(true)
  })

  it("uses max(lastNudgeAt, lastRecordAt) for cadence gate", () => {
    const recentRecord = NOW_MS - 10 * 60_000
    const oldNudge = NOW_MS - 90 * 60_000

    const blockedByRecord = evaluateHydrationNudge(
      baseInput({ lastNudgeAtMs: oldNudge, lastRecordAtMs: recentRecord }),
    )
    expect(blockedByRecord.eligible).toBe(false)
    expect(blockedByRecord.reason).toBe("cadence_gate")

    const allowedAfterRecord = evaluateHydrationNudge(
      baseInput({ lastNudgeAtMs: oldNudge, lastRecordAtMs: NOW_MS - 61 * 60_000 }),
    )
    expect(allowedAfterRecord.eligible).toBe(true)
  })

  it("partial catch-up: recent record blocks re-nudge within cadence", () => {
    const result = evaluateHydrationNudge(
      baseInput({
        lastNudgeAtMs: NOW_MS - 120 * 60_000,
        lastRecordAtMs: NOW_MS - 15 * 60_000,
        requiredRate: 100,
      }),
    )
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe("cadence_gate")
  })
})

describe("evaluateHydrationNudge eligibility", () => {
  it("rejects non-behind pacing statuses", () => {
    for (const status of ["on_pace", "met", "before_window", "window_closed"] as const) {
      const result = evaluateHydrationNudge(baseInput({ pacingStatus: status }))
      expect(result.eligible).toBe(false)
      expect(result.reason).toBe(`status_${status}`)
    }
  })

  it("accepts behind + inside window + user", () => {
    expect(evaluateHydrationNudge(baseInput()).eligible).toBe(true)
  })

  it("rejects non-user persons", () => {
    const result = evaluateHydrationNudge(baseInput({ isUser: false }))
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe("non_user")
  })

  it("rejects outside active window even if status were behind", () => {
    const result = evaluateHydrationNudge(
      baseInput({ nowLocalMinutes: START - 1, pacingStatus: "behind" }),
    )
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe("outside_active_window")
  })
})
