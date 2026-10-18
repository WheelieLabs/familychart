import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  bandSegments,
  defaultTicked,
  formatSeriesValue,
  listSeries,
  parseReferenceRange,
  parseSeriesKey,
  presetRange,
  querySeriesPoints,
  seriesKey,
} from "@/lib/test-results/test-metric-series"

describe("parseReferenceRange", () => {
  it.each([
    ["3.5-5.0", { low: 3.5, high: 5 }],
    [" 115 - 165 ", { low: 115, high: 165 }],
    ["3.5 – 5.0", { low: 3.5, high: 5 }],
  ])("reads the plain pair %j", (text, expected) => {
    expect(parseReferenceRange(text)).toEqual(expected)
  })

  it.each(["< 5", "Male: 3-5", "see comment", "5-3", "5-5", "", null, "-5 - 5", "1-2-3"])(
    "leaves %j unreadable",
    text => expect(parseReferenceRange(text)).toBeNull(),
  )
})

describe("bandSegments", () => {
  const d = (day: number) => `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`
  const t = (day: number) => new Date(d(day)).getTime()

  it("merges neighbours with the same range into one band spanning the series", () => {
    const segs = bandSegments([
      { date: d(1), reference_range: "3-5" },
      { date: d(3), reference_range: "3-5" },
      { date: d(5), reference_range: "3-5" },
    ])
    expect(segs).toEqual([{ startT: t(1), endT: t(5), low: 3, high: 5 }])
  })

  it("steps where the range changes, meeting halfway between the two reports", () => {
    const segs = bandSegments([
      { date: d(1), reference_range: "3-5" },
      { date: d(5), reference_range: "4-6" },
    ])
    expect(segs).toEqual([
      { startT: t(1), endT: t(3), low: 3, high: 5 },
      { startT: t(3), endT: t(5), low: 4, high: 6 },
    ])
  })

  it("leaves a gap for unreadable text and never bridges it", () => {
    const segs = bandSegments([
      { date: d(1), reference_range: "3-5" },
      { date: d(3), reference_range: "< 5" },
      { date: d(5), reference_range: "3-5" },
    ])
    expect(segs).toEqual([
      { startT: t(1), endT: t(2), low: 3, high: 5 },
      { startT: t(4), endT: t(5), low: 3, high: 5 },
    ])
  })
})

describe("series keys, ticks and ranges", () => {
  it("round-trips a key, with and without a unit", () => {
    expect(parseSeriesKey(seriesKey("Haemoglobin", "g/L"))).toEqual({ metric_name: "Haemoglobin", unit: "g/L" })
    expect(parseSeriesKey(seriesKey("Ratio", null))).toEqual({ metric_name: "Ratio", unit: null })
    expect(parseSeriesKey("nounit")).toBeNull()
  })

  it("ticks the first six metrics of a panel", () => {
    const series = Array.from({ length: 8 }, (_, i) => ({ metric_name: `M${i}`, unit: "u" }))
    expect(defaultTicked({ panel: "P", series })).toEqual(series.slice(0, 6).map(s => `${s.metric_name}|u`))
  })

  it("builds quick ranges ending today, and All unbounded", () => {
    const today = new Date(2026, 9, 9)
    expect(presetRange("3m", today)).toEqual({ from: "2026-07-09", to: "2026-10-09" })
    expect(presetRange("1y", today)).toEqual({ from: "2025-10-09", to: "2026-10-09" })
    expect(presetRange("all", today)).toEqual({ from: null, to: null })
  })

  it("shows a limit qualifier with the number", () => {
    expect(formatSeriesValue(0.5, "<")).toBe("< 0.5")
    expect(formatSeriesValue(135.4, null)).toBe("135")
  })
})

function createDb() {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE test_metric_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT, metric_name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1, panel TEXT, aliases TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE test_events (id INTEGER PRIMARY KEY AUTOINCREMENT, person_id INTEGER NOT NULL, date TEXT NOT NULL);
    CREATE TABLE test_result_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT, test_event_id INTEGER NOT NULL, metric_name TEXT NOT NULL,
      value_type TEXT NOT NULL, numeric_value REAL, unit TEXT, reference_range TEXT, flag TEXT, limit_qualifier TEXT
    );
    INSERT INTO test_metric_config (metric_name, sort_order, is_active, panel) VALUES
      ('Ferritin', 2, 1, 'Iron, B12 & folate'),
      ('Iron', 1, 0, 'Iron, B12 & folate'),
      ('Haemoglobin', 5, 1, 'FBC'),
      ('Sodium', 9, 1, 'Electrolytes');
  `)
  return db
}

function addEvent(db: Database.Database, person: number, date: string, values: Record<string, unknown>[]) {
  const id = Number(db.prepare("INSERT INTO test_events (person_id, date) VALUES (?, ?)").run(person, date).lastInsertRowid)
  for (const v of values) {
    db.prepare(
      `INSERT INTO test_result_values (test_event_id, metric_name, value_type, numeric_value, unit, reference_range, flag, limit_qualifier)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, v.metric_name, v.value_type ?? "numeric", v.numeric_value ?? null, v.unit ?? null, v.reference_range ?? null, v.flag ?? null, v.limit_qualifier ?? null)
  }
}

describe("listSeries / querySeriesPoints", () => {
  let db: Database.Database
  beforeEach(() => {
    db = createDb()
    addEvent(db, 1, "2026-01-10T00:00:00.000Z", [
      { metric_name: "Haemoglobin", numeric_value: 120, unit: "g/L", reference_range: "115-165" },
      { metric_name: "Ferritin", numeric_value: 40, unit: "ug/L" },
      { metric_name: "Iron", numeric_value: 12, unit: "umol/L" },
      { metric_name: "Sodium", numeric_value: 140, unit: "mmol/L" },
      { metric_name: "COVID", value_type: "qualitative" },
    ])
    addEvent(db, 1, "2026-03-10T00:00:00.000Z", [
      { metric_name: "haemoglobin", numeric_value: 110, unit: "g/L", reference_range: "115-165", flag: "L" },
      { metric_name: "Ferritin", numeric_value: 15, unit: "ug/L", limit_qualifier: "<" },
      { metric_name: "Iron", numeric_value: 14, unit: "umol/L" },
      { metric_name: "Haemoglobin", numeric_value: 7, unit: "g/dL" },
      { metric_name: "COVID", value_type: "qualitative" },
    ])
    addEvent(db, 2, "2026-03-10T00:00:00.000Z", [{ metric_name: "Haemoglobin", numeric_value: 99, unit: "g/L" }])
  })
  afterEach(() => db.close())

  it("lists numeric series with two or more values, one row per metric and unit", () => {
    const { series } = listSeries(db, 1)
    expect(series.map(s => [s.metric_name, s.unit, s.count])).toEqual([
      ["Ferritin", "ug/L", 2],
      ["Haemoglobin", "g/L", 2], // case-insensitive name; g/dL and Sodium have one value, COVID is qualitative
      ["Iron", "umol/L", 2],
    ])
    const hb = series.find(s => s.metric_name === "Haemoglobin")!
    expect(hb).toMatchObject({ latest_value: 110, latest_date: "2026-03-10T00:00:00.000Z" })
    expect(series.find(s => s.metric_name === "Ferritin")).toMatchObject({ latest_value: 15, latest_qualifier: "<" })
  })

  it("carries catalogue aliases so search can find Hb", () => {
    db.prepare("UPDATE test_metric_config SET aliases = '[\"Hb\"]' WHERE metric_name = 'Haemoglobin'").run()
    expect(listSeries(db, 1).series.find(s => s.metric_name === "Haemoglobin")!.aliases).toEqual(["Hb"])
  })

  it("scopes to the person", () => {
    expect(listSeries(db, 2).series).toEqual([])
  })

  it("looks panels up by catalogue name, including inactive metrics, in catalogue order", () => {
    const { panels } = listSeries(db, 1)
    expect(panels).toEqual([
      { panel: "Iron, B12 & folate", series: [{ metric_name: "Iron", unit: "umol/L" }, { metric_name: "Ferritin", unit: "ug/L" }] },
    ])
  })

  it("returns one unit's points oldest first, with qualifier, range and flag, and honours the date range", () => {
    expect(querySeriesPoints(db, 1, "Haemoglobin", "g/L")).toEqual([
      { date: "2026-01-10T00:00:00.000Z", value: 120, limit_qualifier: null, reference_range: "115-165", flag: null },
      { date: "2026-03-10T00:00:00.000Z", value: 110, limit_qualifier: null, reference_range: "115-165", flag: "L" },
    ])
    expect(querySeriesPoints(db, 1, "Haemoglobin", "g/L", ["e.date >= ?"], ["2026-02-01T00:00:00.000Z"])).toHaveLength(1)
    expect(querySeriesPoints(db, 1, "Haemoglobin", "g/dL")).toHaveLength(1)
    expect(querySeriesPoints(db, 1, "Ferritin", "ug/L")[1].limit_qualifier).toBe("<")
  })

  it("is not capped by the history row limit", () => {
    for (let i = 0; i < 700; i++) {
      addEvent(db, 1, `2020-01-01T00:00:${String(i % 60).padStart(2, "0")}.${String(i).padStart(3, "0")}Z`, [
        { metric_name: "Sodium", numeric_value: 140, unit: "mmol/L" },
      ])
    }
    expect(querySeriesPoints(db, 1, "Sodium", "mmol/L").length).toBe(701)
  })
})
