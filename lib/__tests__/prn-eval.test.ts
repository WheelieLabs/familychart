// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import type { FrequencyRule } from "@/lib/domain-types"
import { allowsOnlyOneDosePerDay, type MedicationDoseSlice } from "@/lib/prn/prn-eval"

function slice(
  rule: Partial<FrequencyRule> & { max_per_24h_count_doses?: number },
  extra: Partial<MedicationDoseSlice> = {},
): MedicationDoseSlice {
  return {
    rule: { min_hours_between: 0, ...rule } as FrequencyRule,
    total24h: 0,
    lastDose: null,
    oldest24h: null,
    lastDosage: null,
    catalogDefaultDosage: null,
    ...extra,
  }
}

describe("allowsOnlyOneDosePerDay", () => {
  it("is true for a count maximum of 1 and false for 2", () => {
    expect(allowsOnlyOneDosePerDay(slice({ max_quantity_per_24h: 1, max_per_24h_count_doses: 1 }))).toBe(true)
    expect(allowsOnlyOneDosePerDay(slice({ max_quantity_per_24h: 2, max_per_24h_count_doses: 1 }))).toBe(false)
  })

  it("is true for a quantity maximum of one dose unit, resolving the unit like the cap check", () => {
    expect(allowsOnlyOneDosePerDay(slice({ max_quantity_per_24h: 500, dosage: 500 }))).toBe(true)
    expect(allowsOnlyOneDosePerDay(slice({ max_quantity_per_24h: 500 }, { catalogDefaultDosage: 500 }))).toBe(true)
    expect(allowsOnlyOneDosePerDay(slice({ max_quantity_per_24h: 500 }, { lastDosage: 500 }))).toBe(true)
    expect(allowsOnlyOneDosePerDay(slice({ max_quantity_per_24h: 1000, dosage: 500 }))).toBe(false)
  })

  it("is false when the dose unit cannot be resolved, when there is no maximum, or no rule", () => {
    expect(allowsOnlyOneDosePerDay(slice({ max_quantity_per_24h: 500 }))).toBe(false)
    expect(allowsOnlyOneDosePerDay(slice({ max_quantity_per_24h: null }))).toBe(false)
    expect(allowsOnlyOneDosePerDay({ ...slice({}), rule: null })).toBe(false)
  })
})
