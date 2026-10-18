import { describe, expect, it } from "vitest"
import { TEST_METRIC_CATALOGUE } from "@/lib/test-results/test-metric-catalogue"
import { matchMetric } from "@/lib/test-results/pdf-prefill/match"
import type { TestMetricConfig } from "@/lib/domain-types"

const configs: TestMetricConfig[] = TEST_METRIC_CATALOGUE.map((m, i) => ({
  id: i + 1, metric_name: m.name, unit: m.unit, sort_order: i + 1, is_active: 1,
  aliases: m.aliases, panel: m.panel, value_type: m.valueType,
}))

describe("matchMetric", () => {
  it("matches canonical names and aliases", () => {
    expect(matchMetric(configs, "Haemoglobin", "g/L")).toMatchObject({ kind: "match", config: { metric_name: "Haemoglobin" } })
    expect(matchMetric(configs, "Hb", null)).toMatchObject({ kind: "match", config: { metric_name: "Haemoglobin" } })
    expect(matchMetric(configs, "Pot.", "mmol/L")).toMatchObject({ kind: "match", config: { metric_name: "Potassium" } })
    expect(matchMetric(configs, "BUN", null)).toMatchObject({ kind: "match", config: { metric_name: "Urea" } })
  })

  it("ignores a leading asterisk, trailing colon and a parenthetical like (serum)", () => {
    expect(matchMetric(configs, "*Creatinine (serum):", "umol/L")).toMatchObject({ kind: "match", config: { metric_name: "Creatinine" } })
  })

  it("resolves HbA1c to the entry whose unit the report prints", () => {
    expect(matchMetric(configs, "HbA1c", "mmol/mol")).toMatchObject({ kind: "match", config: { metric_name: "HbA1c (mmol/mol)" } })
    expect(matchMetric(configs, "HbA1c", "%")).toMatchObject({ kind: "match", config: { metric_name: "HbA1c (%)" } })
  })

  it("leaves HbA1c ambiguous when no unit settles it", () => {
    const result = matchMetric(configs, "HbA1c", null)
    expect(result.kind).toBe("ambiguous")
    if (result.kind === "ambiguous") {
      expect(result.candidates.map(c => c.metric_name)).toEqual(["HbA1c (mmol/mol)", "HbA1c (%)"])
    }
  })

  it("never guesses a bare Glucose: fasting and random are both offered", () => {
    const result = matchMetric(configs, "Glucose", "mmol/L")
    expect(result.kind).toBe("ambiguous")
    if (result.kind === "ambiguous") {
      expect(result.candidates.map(c => c.metric_name).sort()).toEqual(["Glucose (fasting)", "Glucose (random)"])
    }
  })

  it("does not match by substring or unknown names", () => {
    expect(matchMetric(configs, "Anti-Xa", "IU/mL")).toEqual({ kind: "none" })
    expect(matchMetric(configs, "Cholesterol Panel Result", null)).toEqual({ kind: "none" })
  })

  it("skips inactive metrics", () => {
    const hidden = configs.map(c => (c.metric_name === "Sodium" ? { ...c, is_active: 0 } : c))
    expect(matchMetric(hidden, "Sodium", "mmol/L")).toEqual({ kind: "none" })
  })

  describe("SA Pathology reports", () => {
    it("never matches a percentage row to a count metric", () => {
      expect(matchMetric(configs, "Neutrophils %", "%")).toEqual({ kind: "none" })
      expect(matchMetric(configs, "Lymphocytes", "%")).toEqual({ kind: "none" })
      expect(matchMetric(configs, "Neutrophils", "x10^9/L")).toMatchObject({ kind: "match", config: { metric_name: "Neutrophils" } })
    })

    it("still matches a metric whose own unit is a percentage", () => {
      expect(matchMetric(configs, "HbA1c", "%")).toMatchObject({ kind: "match", config: { metric_name: "HbA1c (%)" } })
      expect(matchMetric(configs, "Transferrin Saturation", "%")).toMatchObject({ kind: "match", config: { metric_name: "Transferrin Saturation" } })
    })

    it("matches the singular and 25-hydroxy aliases and the five added analytes", () => {
      expect(matchMetric(configs, "Triglyceride", "mmol/L")).toMatchObject({ kind: "match", config: { metric_name: "Triglycerides" } })
      expect(matchMetric(configs, "25-hydroxy Vitamin D3", "nmol/L")).toMatchObject({ kind: "match", config: { metric_name: "25-Hydroxyvitamin D" } })
      for (const [printed, expected] of [
        ["Mean Platelet Volume", "Mean Platelet Volume"], ["Anion Gap", "Anion Gap"], ["Ionised Calcium", "Ionised Calcium"],
        ["Globulin", "Globulin"], ["Lactate Dehydrogenase", "Lactate Dehydrogenase"],
      ] as const) {
        expect(matchMetric(configs, printed, null)).toMatchObject({ kind: "match", config: { metric_name: expected } })
      }
    })

    it("reads Calcium (ionised) as ionised calcium, not total calcium, even though a parenthetical is dropped elsewhere", () => {
      expect(matchMetric(configs, "Calcium (ionised)", "mmol/L")).toMatchObject({ kind: "match", config: { metric_name: "Ionised Calcium" } })
      expect(matchMetric(configs, "Calcium", "mmol/L")).toMatchObject({ kind: "match", config: { metric_name: "Calcium (total)" } })
    })
  })
})
