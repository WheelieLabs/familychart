import { describe, it, expect } from "vitest"
import {
  HYDRATION_PRESETS,
  matchingHydrationPreset,
  parseHydrationFavouriteAmount,
  validateFavouriteDefaultValue,
  favouriteRecordHref,
} from "@/lib/hydration/hydration-presets"

describe("HYDRATION_PRESETS", () => {
  it("are mug, can, glass, bottle in ascending size", () => {
    expect(HYDRATION_PRESETS).toEqual([
      { ml: 250, label: "Mug" },
      { ml: 375, label: "Can" },
      { ml: 400, label: "Glass" },
      { ml: 600, label: "Bottle" },
    ])
  })
})

describe("matchingHydrationPreset", () => {
  it("matches a preset amount in mL", () => {
    expect(matchingHydrationPreset("375", "mL")?.label).toBe("Can")
  })
  it("does not match other amounts or units", () => {
    expect(matchingHydrationPreset("300", "mL")).toBeNull()
    expect(matchingHydrationPreset("250", "L")).toBeNull()
  })
})

describe("parseHydrationFavouriteAmount", () => {
  it("accepts whole positive mL amounts", () => {
    expect(parseHydrationFavouriteAmount("250")).toBe(250)
    expect(parseHydrationFavouriteAmount(" 1200 ")).toBe(1200)
  })
  it.each(["", "0", "-5", "abc", "2.5", "250ml", "10001", "Infinity"])("rejects %j", (raw) => {
    expect(parseHydrationFavouriteAmount(raw)).toBeNull()
  })
})

describe("validateFavouriteDefaultValue", () => {
  it("leaves medication favourites unchanged (free text dose)", () => {
    expect(validateFavouriteDefaultValue("medication", null, " 2 ")).toEqual({ ok: true, value: "2" })
  })
  it("treats blank as no default", () => {
    expect(validateFavouriteDefaultValue("observation", "Hydration", "  ")).toEqual({ ok: true, value: null })
    expect(validateFavouriteDefaultValue("observation", "Hydration", null)).toEqual({ ok: true, value: null })
  })
  it("normalises a valid Hydration amount", () => {
    expect(validateFavouriteDefaultValue("observation", "Hydration", " 400 ")).toEqual({ ok: true, value: "400" })
  })
  it("rejects an invalid Hydration amount", () => {
    expect(validateFavouriteDefaultValue("observation", "Hydration", "lots")).toEqual({
      ok: false,
      error: "Amount must be a whole number of mL between 1 and 10000",
    })
  })
  it("rejects a default on other observation types", () => {
    expect(validateFavouriteDefaultValue("observation", "Weight", "70")).toEqual({
      ok: false,
      error: "default_value is only supported for Hydration observation favourites",
    })
  })
})

describe("favouriteRecordHref", () => {
  it("passes the dose for medication favourites", () => {
    expect(
      favouriteRecordHref({ action_kind: "medication", person_id: 3, medication_id: 9, observation_type: null, default_value: "2" }),
    ).toBe("/3/record-medication?medication_id=9&dosage=2")
  })
  it("passes the amount for Hydration favourites", () => {
    expect(
      favouriteRecordHref({ action_kind: "observation", person_id: 3, medication_id: null, observation_type: "Hydration", default_value: "375" }),
    ).toBe("/3/record-observation?type=Hydration&amount=375")
  })
  it("omits the amount when there is none", () => {
    expect(
      favouriteRecordHref({ action_kind: "observation", person_id: 3, medication_id: null, observation_type: "Hydration", default_value: null }),
    ).toBe("/3/record-observation?type=Hydration")
  })
})
