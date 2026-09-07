import { describe, it, expect } from "vitest"
import {
  findRuleFromList,
  ruleMax24hIsDoseCount,
  ruleHasWeightBand,
  parseMinHoursBetweenFromApi,
  type FrequencyRule,
} from "@/lib/frequency-rule"

// Minimal rule factory — only set what the test cares about
function rule(overrides: Partial<FrequencyRule> = {}): FrequencyRule {
  return {
    id: 1,
    medication_id: 1,
    min_hours_between: 4,
    max_hours_between: null,
    max_quantity_per_24h: null,
    max_quantity_unit: null,
    max_per_24h_count_doses: 0,
    min_age_years: null,
    max_age_years: null,
    min_weight_kg: null,
    max_weight_kg: null,
    dosage: null,
    ...overrides,
  }
}

describe("findRuleFromList", () => {
  it("returns null for an empty list", () => {
    expect(findRuleFromList([], 5, 20)).toBeNull()
  })

  it("returns the only rule when there is one", () => {
    const r = rule({ id: 1 })
    expect(findRuleFromList([r], null, null)).toBe(r)
  })

  it("excludes a weight-banded rule when the patient's weight is outside its range", () => {
    const banded = rule({ id: 2, min_weight_kg: 20, max_weight_kg: 40 })
    const generic = rule({ id: 1 })
    expect(findRuleFromList([banded, generic], null, 60)).toBe(generic)
  })

  it("picks a weight-banded rule when it has a narrower age band than the generic alternative", () => {
    // Both pass the weight check; tiebreaker is age-band width
    const generic = rule({ id: 1 })
    const banded = rule({ id: 2, min_weight_kg: 20, max_weight_kg: 40, min_age_years: 0, max_age_years: 12 })
    expect(findRuleFromList([generic, banded], 8, 30)).toBe(banded)
  })

  it("picks the narrowest age band when multiple rules match", () => {
    const broad = rule({ id: 1, min_age_years: 0, max_age_years: 18 })
    const narrow = rule({ id: 2, min_age_years: 6, max_age_years: 12 })
    expect(findRuleFromList([broad, narrow], 8, null)).toBe(narrow)
  })

  it("picks by narrowest age band even when weight is null", () => {
    const broad = rule({ id: 1, min_age_years: 0, max_age_years: 18 })
    const narrow = rule({ id: 2, min_age_years: 6, max_age_years: 12 })
    expect(findRuleFromList([broad, narrow], 8, null)).toBe(narrow)
  })

  it("handles null age — selects based on weight band only", () => {
    const banded = rule({ id: 1, min_weight_kg: 10, max_weight_kg: 50 })
    expect(findRuleFromList([banded], null, 30)).toBe(banded)
  })

  it("returns null when weight is null and only weight-banded rules exist", () => {
    const banded = rule({ id: 1, min_weight_kg: 10, max_weight_kg: 50 })
    expect(findRuleFromList([banded], null, null)).toBeNull()
  })

  it("uses the closest weight band when nothing matches exactly", () => {
    const low = rule({ id: 1, min_weight_kg: 5, max_weight_kg: 20 })
    const high = rule({ id: 2, min_weight_kg: 40, max_weight_kg: 80 })
    // 25kg — closer to low band (distance 5) than high band (distance 15)
    expect(findRuleFromList([low, high], null, 25)).toBe(low)
  })
})

describe("ruleMax24hIsDoseCount", () => {
  it("returns false when rule is null", () => {
    expect(ruleMax24hIsDoseCount(null)).toBe(false)
  })

  it("returns true when max_per_24h_count_doses is 1", () => {
    expect(ruleMax24hIsDoseCount(rule({ max_per_24h_count_doses: 1 }))).toBe(true)
  })

  it("returns false when max_per_24h_count_doses is 0", () => {
    expect(ruleMax24hIsDoseCount(rule({ max_per_24h_count_doses: 0 }))).toBe(false)
  })
})

describe("ruleHasWeightBand", () => {
  it("returns false for null rule", () => {
    expect(ruleHasWeightBand(null)).toBe(false)
  })

  it("returns false when both weight bounds are null", () => {
    expect(ruleHasWeightBand(rule())).toBe(false)
  })

  it("returns true when min_weight_kg is set", () => {
    expect(ruleHasWeightBand(rule({ min_weight_kg: 10 }))).toBe(true)
  })

  it("returns true when max_weight_kg is set", () => {
    expect(ruleHasWeightBand(rule({ max_weight_kg: 50 }))).toBe(true)
  })
})

describe("parseMinHoursBetweenFromApi", () => {
  it("accepts a valid positive number", () => {
    expect(parseMinHoursBetweenFromApi(4)).toEqual({ ok: true, value: 4 })
  })

  it("accepts 0 (PRN — no minimum interval)", () => {
    expect(parseMinHoursBetweenFromApi(0)).toEqual({ ok: true, value: 0 })
  })

  it("accepts a numeric string", () => {
    expect(parseMinHoursBetweenFromApi("4.5")).toEqual({ ok: true, value: 4.5 })
  })

  it("rejects undefined", () => {
    const result = parseMinHoursBetweenFromApi(undefined)
    expect(result.ok).toBe(false)
  })

  it("rejects null", () => {
    const result = parseMinHoursBetweenFromApi(null)
    expect(result.ok).toBe(false)
  })

  it("rejects a negative number", () => {
    const result = parseMinHoursBetweenFromApi(-1)
    expect(result.ok).toBe(false)
  })

  it("rejects NaN", () => {
    const result = parseMinHoursBetweenFromApi("not-a-number")
    expect(result.ok).toBe(false)
  })
})
