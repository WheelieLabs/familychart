import Database from "better-sqlite3-multiple-ciphers"
import { describe, expect, it } from "vitest"
import { applyBaselineSchema } from "@/lib/db"
import { MIGRATIONS, runMigrations } from "@/lib/db-migrations"
import { listTestMetricConfigs } from "@/lib/test-results/test-metric-meta"
import { TEST_METRIC_CATALOGUE, syncTestMetricCatalogue } from "@/lib/test-results/test-metric-catalogue"

function freshDb(): Database.Database {
  const db = new Database(":memory:")
  applyBaselineSchema(db)
  runMigrations(db)
  return db
}

describe("test metric catalogue", () => {
  it("has unique, case-insensitive names", () => {
    const names = TEST_METRIC_CATALOGUE.map(m => m.name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
  })

  it("keeps the original ten names (existing results store the name as text)", () => {
    const names = TEST_METRIC_CATALOGUE.map(m => m.name)
    for (const original of [
      "Haemoglobin", "White Cell Count", "Platelet Count", "C-Reactive Protein", "Sodium",
      "Potassium", "Creatinine", "Glucose (fasting)", "COVID-19 RAT", "Strep A",
    ]) {
      expect(names).toContain(original)
    }
  })

  it("covers roughly 45+ numeric metrics with a panel each", () => {
    const numeric = TEST_METRIC_CATALOGUE.filter(m => m.valueType === "numeric")
    expect(numeric.length).toBeGreaterThanOrEqual(45)
    expect(TEST_METRIC_CATALOGUE.every(m => m.panel.length > 0)).toBe(true)
  })

  it("splits HbA1c into two unit entries and adds Glucose (random)", () => {
    const byName = new Map(TEST_METRIC_CATALOGUE.map(m => [m.name, m]))
    expect(byName.get("HbA1c (mmol/mol)")?.unit).toBe("mmol/mol")
    expect(byName.get("HbA1c (%)")?.unit).toBe("%")
    expect(byName.get("Glucose (random)")).toBeDefined()
    expect(byName.get("Glucose (fasting)")).toBeDefined()
  })

  it("marks only the rapid tests qualitative", () => {
    const qualitative = TEST_METRIC_CATALOGUE.filter(m => m.valueType === "qualitative").map(m => m.name)
    expect(qualitative.sort()).toEqual(["COVID-19 RAT", "Strep A"])
  })

  it("carries US names as aliases (BUN, Pot., Hb, TSH)", () => {
    const aliasesOf = (name: string) => TEST_METRIC_CATALOGUE.find(m => m.name === name)?.aliases ?? []
    expect(aliasesOf("Urea")).toContain("BUN")
    expect(aliasesOf("Potassium")).toContain("Pot.")
    expect(aliasesOf("Haemoglobin")).toContain("Hb")
    expect(aliasesOf("Thyroid Stimulating Hormone")).toContain("TSH")
  })
})

describe("catalogue additions from real SA Pathology reports", () => {
  const byName = new Map(TEST_METRIC_CATALOGUE.map(m => [m.name, m]))

  it("adds the five analytes with their panel and unit", () => {
    expect(byName.get("Mean Platelet Volume")).toMatchObject({ unit: "fL", panel: "Full blood count" })
    expect(byName.get("Anion Gap")).toMatchObject({ unit: "mmol/L", panel: "Urea & electrolytes" })
    expect(byName.get("Ionised Calcium")).toMatchObject({ unit: "mmol/L", panel: "Bone profile" })
    expect(byName.get("Globulin")).toMatchObject({ unit: "g/L", panel: "Liver function" })
    expect(byName.get("Lactate Dehydrogenase")).toMatchObject({ unit: "U/L", aliases: expect.arrayContaining(["LDH"]) })
  })

  it("adds the singular Triglyceride and 25-hydroxy Vitamin D3 aliases", () => {
    expect(byName.get("Triglycerides")?.aliases).toContain("Triglyceride")
    expect(byName.get("25-Hydroxyvitamin D")?.aliases).toContain("25-hydroxy Vitamin D3")
  })

  it("adds no percentage metrics for the differential rows", () => {
    expect(TEST_METRIC_CATALOGUE.filter(m => m.name.includes("%") && m.name !== "HbA1c (%)")).toEqual([])
  })

  it("026 brings an install on the earlier catalogue up to date without touching a hidden row's unit or state", () => {
    const db = freshDb()
    db.prepare("DELETE FROM test_metric_config WHERE metric_name IN ('Anion Gap', 'Globulin')").run()
    db.prepare("UPDATE test_metric_config SET unit = 'g/dL', is_active = 0 WHERE metric_name = 'Albumin'").run()
    MIGRATIONS.find(m => m.id === "026_test_metric_catalogue_additions")!.up(db)
    const rows = listTestMetricConfigs(db)
    expect(rows.map(r => r.metric_name)).toEqual(expect.arrayContaining(["Anion Gap", "Globulin"]))
    expect(rows).toHaveLength(TEST_METRIC_CATALOGUE.length)
    expect(rows.find(r => r.metric_name === "Albumin")).toMatchObject({ unit: "g/dL", is_active: 0 })
    db.close()
  })
})

describe("023_test_metric_catalogue migration", () => {
  it("seeds the whole catalogue with aliases, panel and value type on a fresh install", () => {
    const db = freshDb()
    const rows = listTestMetricConfigs(db)
    expect(rows).toHaveLength(TEST_METRIC_CATALOGUE.length)
    const urea = rows.find(r => r.metric_name === "Urea")
    expect(urea?.aliases).toContain("BUN")
    expect(urea?.panel).toBe("Urea & electrolytes")
    expect(rows.find(r => r.metric_name === "Strep A")?.value_type).toBe("qualitative")
    db.close()
  })

  it("upgrades an install that only has the original ten rows and keeps their unit and hidden state", () => {
    const old = new Database(":memory:")
    old.exec(`
      CREATE TABLE test_metric_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT, metric_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        unit TEXT, sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE test_result_values (
        id INTEGER PRIMARY KEY AUTOINCREMENT, test_event_id INTEGER NOT NULL, metric_name TEXT NOT NULL,
        value_type TEXT NOT NULL, numeric_value REAL, qualitative_value TEXT, unit TEXT,
        reference_range TEXT, flag TEXT
      );
      INSERT INTO test_metric_config (metric_name, unit, sort_order, is_active) VALUES ('Haemoglobin', 'g/dL', 1, 0);
    `)
    MIGRATIONS.find(m => m.id === "023_test_metric_catalogue")!.up(old)
    const hb = listTestMetricConfigs(old).find(r => r.metric_name === "Haemoglobin")
    expect(hb?.unit).toBe("g/dL")
    expect(hb?.is_active).toBe(0)
    expect(hb?.aliases).toContain("Hb")
    old.close()
  })

  it("is idempotent", () => {
    const db = freshDb()
    expect(() => syncTestMetricCatalogue(db)).not.toThrow()
    expect(listTestMetricConfigs(db)).toHaveLength(TEST_METRIC_CATALOGUE.length)
    db.close()
  })

  it("rejects a bad limit_qualifier at the schema level", () => {
    const db = freshDb()
    db.prepare("INSERT INTO people (name) VALUES ('Pat')").run()
    db.prepare("INSERT INTO test_events (person_id, test_type, name, date) VALUES (1, '', 'FBC', '2026-08-01T00:00:00.000Z')").run()
    expect(() =>
      db.prepare(
        "INSERT INTO test_result_values (test_event_id, metric_name, value_type, numeric_value, limit_qualifier) VALUES (1, 'Haemoglobin', 'numeric', 20, '~')",
      ).run(),
    ).toThrow()
    db.close()
  })
})
