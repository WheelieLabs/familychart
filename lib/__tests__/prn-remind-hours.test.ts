import { describe, expect, it } from "vitest"
import {
  PRN_REMIND_DEFAULT_MAX_HOURS,
  resolvePrnRemindAfterHours,
} from "@/lib/prn/prn-remind-hours"

describe("resolvePrnRemindAfterHours", () => {
  it("returns null when the client omits remind_after_hours", () => {
    expect(resolvePrnRemindAfterHours(undefined, 4, 12)).toEqual({ ok: true, hours: null })
    expect(resolvePrnRemindAfterHours(null, 4, 12)).toEqual({ ok: true, hours: null })
    expect(resolvePrnRemindAfterHours("", 4, 12)).toEqual({ ok: true, hours: null })
  })

  it("rejects values below the medication minimum interval", () => {
    const result = resolvePrnRemindAfterHours(2, 4, 12)
    expect(result).toEqual({
      ok: false,
      error: "remind_after_hours cannot be below the minimum interval (4 hours)",
    })
  })

  it("clamps values above the rule max_hours_between", () => {
    expect(resolvePrnRemindAfterHours(20, 4, 12)).toEqual({ ok: true, hours: 12 })
  })

  it("uses the default upper bound when max_hours_between is absent", () => {
    expect(resolvePrnRemindAfterHours(999, 4, null)).toEqual({
      ok: true,
      hours: PRN_REMIND_DEFAULT_MAX_HOURS,
    })
  })

  it("accepts values within the allowed range unchanged", () => {
    expect(resolvePrnRemindAfterHours(6, 4, 12)).toEqual({ ok: true, hours: 6 })
  })
})
