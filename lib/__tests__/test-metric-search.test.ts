import { describe, expect, it } from "vitest"
import { TEST_METRIC_CATALOGUE } from "@/lib/test-results/test-metric-catalogue"
import { searchTestMetrics, recentMetricSuggestions } from "@/lib/test-results/test-metric-search"
import type { TestMetricConfig } from "@/lib/domain-types"

const configs: TestMetricConfig[] = TEST_METRIC_CATALOGUE.map((m, i) => ({
  id: i + 1,
  metric_name: m.name,
  unit: m.unit,
  sort_order: i + 1,
  is_active: 1,
  aliases: m.aliases,
  panel: m.panel,
  value_type: m.valueType,
}))

const names = (query: string, limit?: number) => searchTestMetrics(configs, query, limit).map(m => m.metric_name)

describe("searchTestMetrics", () => {
  it("matches abbreviations through aliases", () => {
    expect(names("Hb")[0]).toBe("Haemoglobin")
    expect(names("TSH")[0]).toBe("Thyroid Stimulating Hormone")
    expect(names("BUN")[0]).toBe("Urea")
    expect(names("Pot.")[0]).toBe("Potassium")
  })

  it("is case-insensitive and ignores punctuation and spacing", () => {
    expect(names("pot")[0]).toBe("Potassium")
    expect(names("free t4")).toContain("Free Thyroxine")
    expect(names("  alk phos ")[0]).toBe("Alkaline Phosphatase")
  })

  it("ranks an exact name or alias above prefix and substring matches", () => {
    expect(names("Sodium")[0]).toBe("Sodium")
    expect(names("Na")[0]).toBe("Sodium")
  })

  it("finds by substring of the canonical name", () => {
    expect(names("cholest")).toEqual(expect.arrayContaining(["Total Cholesterol", "HDL Cholesterol", "LDL Cholesterol"]))
  })

  it("returns both HbA1c entries for an ambiguous alias, in catalogue order", () => {
    expect(names("HbA1c")).toEqual(["HbA1c (mmol/mol)", "HbA1c (%)"])
  })

  it("omits inactive metrics", () => {
    const hidden = configs.map(c => (c.metric_name === "Sodium" ? { ...c, is_active: 0 } : c))
    expect(searchTestMetrics(hidden, "sodium").map(m => m.metric_name)).not.toContain("Sodium")
  })

  it("respects the limit and returns nothing for no match", () => {
    expect(names("a", 5)).toHaveLength(5)
    expect(names("zzzzzz")).toEqual([])
  })
})

describe("recentMetricSuggestions", () => {
  it("returns the most recently recorded distinct metrics, newest first, resolved against the catalogue", () => {
    const events = [
      { date: "2026-08-03T00:00:00Z", values: [{ metric_name: "Sodium" }, { metric_name: "Potassium" }] },
      { date: "2026-08-05T00:00:00Z", values: [{ metric_name: "Haemoglobin" }, { metric_name: "sodium" }] },
      { date: "2026-08-01T00:00:00Z", values: [{ metric_name: "Potassium" }, { metric_name: "Ferritin" }] },
    ]
    const result = recentMetricSuggestions(configs, events, 4)
    expect(result.map(r => r.label)).toEqual(["Haemoglobin", "Sodium", "Potassium", "Ferritin"])
    expect(result[0].config?.metric_name).toBe("Haemoglobin")
  })

  it("keeps free-text (Other) names previously used, without a catalogue config", () => {
    const events = [{ date: "2026-08-05T00:00:00Z", values: [{ metric_name: "Anti-Xa" }] }]
    const result = recentMetricSuggestions(configs, events, 5)
    expect(result).toEqual([{ label: "Anti-Xa", config: null }])
  })
})
