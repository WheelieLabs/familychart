import { describe, expect, it } from "vitest"
import type { TestMetricConfig } from "@/lib/domain-types"
import type { ExtractedRow } from "@/lib/test-results/pdf-prefill/extract"
import { isPdfBlob, isPdfUrl, withoutExistingMetrics } from "@/lib/test-results/pdf-prefill/rescan"
import { TEST_METRIC_CATALOGUE } from "@/lib/test-results/test-metric-catalogue"

const configs: TestMetricConfig[] = TEST_METRIC_CATALOGUE.map((m, i) => ({
  id: i + 1, metric_name: m.name, unit: m.unit, sort_order: i + 1, is_active: 1,
  aliases: m.aliases, panel: m.panel, value_type: m.valueType,
}))

function row(name: string, unit: string | null = null, id = name): ExtractedRow {
  return { id, page: 1, name, value: 1, qualifier: null, unit, range: null, text: name, strip: { top: 10, bottom: 0 } }
}

describe("isPdfUrl / isPdfBlob", () => {
  it("recognises a stored PDF by its URL, ignoring a query string and case", () => {
    expect(isPdfUrl("/api/test-results/uploads/abc.pdf")).toBe(true)
    expect(isPdfUrl("/api/test-results/uploads/ABC.PDF?x=1")).toBe(true)
    expect(isPdfUrl("/api/test-results/uploads/abc.jpg")).toBe(false)
  })

  it("treats a fetched blob as a PDF by its type, or by its name when the type is blank", () => {
    expect(isPdfBlob(new Blob(["x"], { type: "application/pdf" }))).toBe(true)
    expect(isPdfBlob(new Blob(["x"]), "report.PDF")).toBe(true)
    expect(isPdfBlob(new Blob(["x"], { type: "image/jpeg" }), "photo.jpg")).toBe(false)
    expect(isPdfBlob(new Blob(["x"]))).toBe(false)
  })
})

describe("withoutExistingMetrics", () => {
  it("hides a suggestion for a metric already on the result, and keeps the rest", () => {
    const rows = [row("Haemoglobin", "g/L"), row("Ferritin", "µg/L"), row("Hb", "g/L", "alias")]
    const fresh = withoutExistingMetrics(rows, configs, [{ metric_name: "Haemoglobin", isOther: false }])
    expect(fresh.map(r => r.name)).toEqual(["Ferritin"])
  })

  it("compares catalogue names without regard to case", () => {
    const fresh = withoutExistingMetrics([row("Sodium", "mmol/L")], configs, [{ metric_name: "sodium", isOther: false }])
    expect(fresh).toEqual([])
  })

  it("treats HbA1c in the other unit as already represented", () => {
    const fresh = withoutExistingMetrics([row("HbA1c")], configs, [{ metric_name: "HbA1c (%)", isOther: false }])
    expect(fresh).toEqual([])
  })

  it("hides an ambiguous bare Glucose when either glucose entry is present", () => {
    const fresh = withoutExistingMetrics([row("Glucose", "mmol/L")], configs, [{ metric_name: "Glucose (random)", isOther: false }])
    expect(fresh).toEqual([])
  })

  it("matches an unmatched row to an Other value by normalised name", () => {
    const rows = [row("Anti-Xa Level"), row("Zinc")]
    const fresh = withoutExistingMetrics(rows, configs, [{ metric_name: "anti xa level", isOther: true }])
    expect(fresh.map(r => r.name)).toEqual(["Zinc"])
  })

  it("does not let an Other value hide a catalogue suggestion of the same text, nor the reverse", () => {
    expect(withoutExistingMetrics([row("Sodium", "mmol/L")], configs, [{ metric_name: "Sodium", isOther: true }])).toHaveLength(1)
    expect(withoutExistingMetrics([row("Zinc")], configs, [{ metric_name: "Zinc", isOther: false }])).toHaveLength(1)
  })

  it("offers everything when nothing is on the result, and nothing when everything is", () => {
    const rows = [row("Sodium", "mmol/L"), row("Potassium", "mmol/L")]
    expect(withoutExistingMetrics(rows, configs, [])).toHaveLength(2)
    expect(withoutExistingMetrics(rows, configs, [
      { metric_name: "Sodium", isOther: false }, { metric_name: "Potassium", isOther: false },
    ])).toEqual([])
  })
})
