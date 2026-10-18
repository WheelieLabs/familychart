// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import { goalTypesFor, isGoalEligible } from "@/lib/observation/goal-eligibility"

describe("goal eligibility", () => {
  it.each(["Temperature", "Blood Pressure", "Heart Rate", "SpO2", "Blood Glucose", "Respirations"])(
    "%s takes a range goal",
    type => {
      expect(goalTypesFor(type)).toEqual(["range"])
      expect(isGoalEligible(type, "range")).toBe(true)
    },
  )

  it("Hydration takes a daily minimum and Weight a range and a trend", () => {
    expect(goalTypesFor("Hydration")).toEqual(["daily_min"])
    expect(goalTypesFor("Weight")).toEqual(["range", "trend"])
  })

  it.each(["Height", "Head Circumference", "Unknown"])("%s has no goals", type => {
    expect(goalTypesFor(type)).toEqual([])
    expect(isGoalEligible(type)).toBe(false)
    expect(isGoalEligible(type, "range")).toBe(false)
  })

  it("rejects a goal type the observation does not offer", () => {
    expect(isGoalEligible("Temperature", "daily_min")).toBe(false)
  })
})
