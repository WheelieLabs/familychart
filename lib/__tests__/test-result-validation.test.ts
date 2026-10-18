import Database from "better-sqlite3-multiple-ciphers"
import { beforeEach, describe, expect, it } from "vitest"
import { validateTestEventWrite, validateTestResultValueWrite } from "@/lib/test-results/test-result-validation"

let db: Database.Database

beforeEach(() => {
  db = new Database(":memory:")
  db.exec(`
    CREATE TABLE test_metric_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric_name TEXT NOT NULL UNIQUE,
      unit TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      aliases TEXT NOT NULL DEFAULT '[]',
      panel TEXT,
      value_type TEXT NOT NULL DEFAULT 'numeric'
    );
    INSERT INTO test_metric_config (metric_name, unit, is_active) VALUES
      ('Haemoglobin', 'g/L', 1),
      ('Retired Metric', null, 0);
  `)
})

describe("validateTestEventWrite", () => {
  it("accepts a well-formed test event", () => {
    const result = validateTestEventWrite({
      test_type: "Blood test",
      name: "Full Blood Count",
      date: "2026-08-01T09:00:00.000Z",
      ordered_by: "Dr Smith",
      notes: "Fasting",
    })
    expect(result).toEqual({
      ok: true,
      testType: "Blood test",
      name: "Full Blood Count",
      date: "2026-08-01T09:00:00.000Z",
      orderedBy: "Dr Smith",
      notes: "Fasting",
    })
  })

  it("accepts a missing test_type (the form asks for a single Name) and stores it as empty", () => {
    const result = validateTestEventWrite({ name: "FBC", date: "2026-08-01T09:00:00.000Z" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.testType).toBe("")
  })

  it("rejects a missing name", () => {
    const result = validateTestEventWrite({ test_type: "Blood test", name: "  ", date: "2026-08-01T09:00:00.000Z" })
    expect(result.ok).toBe(false)
  })

  it("rejects an invalid date", () => {
    const result = validateTestEventWrite({ test_type: "Blood test", name: "FBC", date: "not-a-date" })
    expect(result.ok).toBe(false)
  })

  it("defaults ordered_by/notes to null when absent", () => {
    const result = validateTestEventWrite({ test_type: "Blood test", name: "FBC", date: "2026-08-01T09:00:00.000Z" })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.orderedBy).toBeNull()
      expect(result.notes).toBeNull()
    }
  })
})

describe("validateTestResultValueWrite", () => {
  it("accepts a numeric value against an active catalogue metric", () => {
    const result = validateTestResultValueWrite(db, {
      metric_name: "Haemoglobin",
      value_type: "numeric",
      numeric_value: 135,
      unit: "g/L",
      reference_range: "115-165 g/L",
    })
    expect(result).toEqual({
      ok: true,
      metricName: "Haemoglobin",
      valueType: "numeric",
      numericValue: 135,
      qualitativeValue: null,
      unit: "g/L",
      referenceRange: "115-165 g/L",
      flag: null,
      limitQualifier: null,
      isOther: false,
    })
  })

  it("accepts a qualitative value with a flag", () => {
    const result = validateTestResultValueWrite(db, {
      metric_name: "Haemoglobin",
      value_type: "qualitative",
      qualitative_value: "Detected",
      flag: "differs from expected",
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.valueType).toBe("qualitative")
      expect(result.qualitativeValue).toBe("Detected")
      expect(result.flag).toBe("differs from expected")
    }
  })

  it("rejects an unknown metric", () => {
    const result = validateTestResultValueWrite(db, {
      metric_name: "Not A Real Metric",
      value_type: "numeric",
      numeric_value: 1,
    })
    expect(result.ok).toBe(false)
  })

  it("rejects an inactive metric", () => {
    const result = validateTestResultValueWrite(db, {
      metric_name: "Retired Metric",
      value_type: "numeric",
      numeric_value: 1,
    })
    expect(result.ok).toBe(false)
  })

  it("rejects numeric value_type without a finite numeric_value", () => {
    const result = validateTestResultValueWrite(db, {
      metric_name: "Haemoglobin",
      value_type: "numeric",
      numeric_value: "not a number",
    })
    expect(result.ok).toBe(false)
  })

  it("rejects qualitative value_type without a qualitative_value", () => {
    const result = validateTestResultValueWrite(db, {
      metric_name: "Haemoglobin",
      value_type: "qualitative",
      qualitative_value: "",
    })
    expect(result.ok).toBe(false)
  })

  it("rejects an unrecognised value_type", () => {
    const result = validateTestResultValueWrite(db, {
      metric_name: "Haemoglobin",
      value_type: "weird",
      numeric_value: 1,
    })
    expect(result.ok).toBe(false)
  })

  describe("other: true (freeform metric name, not in the catalogue)", () => {
    it("accepts a metric name that isn't in the catalogue", () => {
      const result = validateTestResultValueWrite(db, {
        metric_name: "Vitamin D (25-OH)",
        value_type: "numeric",
        numeric_value: 42,
        unit: "nmol/L",
        other: true,
      })
      expect(result).toEqual({
        ok: true,
        metricName: "Vitamin D (25-OH)",
        valueType: "numeric",
        numericValue: 42,
        qualitativeValue: null,
        unit: "nmol/L",
        referenceRange: null,
        flag: null,
        limitQualifier: null,
        isOther: true,
      })
    })

    it("still requires a non-empty metric name", () => {
      const result = validateTestResultValueWrite(db, {
        metric_name: "  ",
        value_type: "numeric",
        numeric_value: 1,
        other: true,
      })
      expect(result.ok).toBe(false)
    })

    it("still enforces value_type-specific validation", () => {
      const result = validateTestResultValueWrite(db, {
        metric_name: "Vitamin D (25-OH)",
        value_type: "numeric",
        numeric_value: "not a number",
        other: true,
      })
      expect(result.ok).toBe(false)
    })

    it("bypasses the catalogue lookup entirely, even for a name matching an inactive row", () => {
      const result = validateTestResultValueWrite(db, {
        metric_name: "Retired Metric",
        value_type: "numeric",
        numeric_value: 1,
        other: true,
      })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.isOther).toBe(true)
    })
  })

  it("still rejects an unknown metric when other is not set", () => {
    const result = validateTestResultValueWrite(db, {
      metric_name: "Vitamin D (25-OH)",
      value_type: "numeric",
      numeric_value: 42,
    })
    expect(result.ok).toBe(false)
  })
})

describe("limit_qualifier", () => {
  const base = { metric_name: "Haemoglobin", value_type: "numeric", numeric_value: 20 }

  it.each(["<", "<=", ">", ">="])("accepts %s on a numeric result", qualifier => {
    const result = validateTestResultValueWrite(db, { ...base, limit_qualifier: qualifier })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.limitQualifier).toBe(qualifier)
      expect(result.numericValue).toBe(20)
    }
  })

  it("treats an empty qualifier as none", () => {
    const result = validateTestResultValueWrite(db, { ...base, limit_qualifier: "" })
    expect(result.ok && result.limitQualifier).toBeNull()
  })

  it("rejects an unknown qualifier", () => {
    expect(validateTestResultValueWrite(db, { ...base, limit_qualifier: "~" }).ok).toBe(false)
  })

  it("rejects a qualifier on a qualitative result", () => {
    const result = validateTestResultValueWrite(db, {
      metric_name: "Haemoglobin", value_type: "qualitative", qualitative_value: "Detected", limit_qualifier: "<",
    })
    expect(result.ok).toBe(false)
  })
})
