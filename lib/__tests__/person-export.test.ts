import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  getPersonExportData,
  administrationsToCsv,
  observationsToCsv,
  testResultsToCsv,
  symptomsToCsv,
  symptomDoseLinksToCsv,
} from "@/lib/person/person-export"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, full_name TEXT,
      date_of_birth TEXT, photo_url TEXT
    );
    CREATE TABLE medications (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE medication_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL, medication_id INTEGER NOT NULL,
      recorded_at TEXT NOT NULL, dosage REAL, dosage_unit TEXT, comments TEXT, administered_by TEXT
    );
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL, observation_type TEXT NOT NULL,
      value REAL NOT NULL, unit TEXT NOT NULL, value_label TEXT,
      recorded_at TEXT NOT NULL, comments TEXT
    );
    CREATE TABLE test_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, person_id INTEGER NOT NULL,
      test_type TEXT NOT NULL, name TEXT NOT NULL, date TEXT NOT NULL,
      ordered_by TEXT, notes TEXT, attachment_url TEXT
    );
    CREATE TABLE test_result_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT, test_event_id INTEGER NOT NULL,
      metric_name TEXT NOT NULL, value_type TEXT NOT NULL, numeric_value REAL,
      qualitative_value TEXT, unit TEXT, reference_range TEXT, flag TEXT, limit_qualifier TEXT
    );
    CREATE TABLE symptom_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, person_id INTEGER NOT NULL,
      label TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT,
      severity INTEGER NOT NULL, is_resolved INTEGER NOT NULL DEFAULT 0,
      resolved_at TEXT, notes TEXT
    );
    CREATE TABLE symptom_dose_links (
      symptom_event_id INTEGER NOT NULL, medication_record_id INTEGER NOT NULL, person_id INTEGER NOT NULL,
      created_by TEXT, created_at TEXT, PRIMARY KEY (symptom_event_id, medication_record_id)
    );
  `)
  return db
}

describe("person-export", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    db.prepare("INSERT INTO people (id, name, full_name, date_of_birth, photo_url) VALUES (1, 'Pat', 'Patricia', '2015-01-01', '/api/uploads/pat.jpg')").run()
    db.prepare("INSERT INTO medications (id, name) VALUES (1, 'Paracetamol')").run()
  })

  afterEach(() => db.close())

  it("returns null for a person that doesn't exist", () => {
    expect(getPersonExportData(db, 999)).toBeNull()
  })

  it("gathers administrations and observations in native units, no conversion or roll-up", () => {
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at, dosage, dosage_unit, comments, administered_by) VALUES (1, 1, '2026-01-01T08:00:00Z', 2, 'Tabs', 'with food', 'away_from_home')",
    ).run()
    db.prepare(
      "INSERT INTO observations (person_id, observation_type, value, unit, value_label, recorded_at, comments) VALUES (1, 'Weight', 5.5, 'kg', NULL, '2026-01-02T09:00:00Z', NULL)",
    ).run()
    db.prepare(
      "INSERT INTO observations (person_id, observation_type, value, unit, value_label, recorded_at, comments) VALUES (1, 'Weight', 12.1, 'lb', NULL, '2026-01-03T09:00:00Z', NULL)",
    ).run()

    const data = getPersonExportData(db, 1)!
    expect(data.person.name).toBe("Pat")
    expect(data.administrations).toEqual([
      {
        recorded_at: "2026-01-01T08:00:00Z", medication_name: "Paracetamol", dosage: 2, dosage_unit: "Tabs",
        comments: "with food", administered_by: "away_from_home",
      },
    ])
    // Both units preserved as recorded — no conversion to a common unit.
    expect(data.observations.map(o => o.unit)).toEqual(["kg", "lb"])
  })

  it("writes administrations as a readable CSV by medication name", () => {
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at, dosage, dosage_unit, comments) VALUES (1, 1, '2026-01-01T08:00:00Z', 2, 'Tabs', NULL)",
    ).run()
    db.prepare(
      "INSERT INTO observations (person_id, observation_type, value, unit, value_label, recorded_at, comments) VALUES (1, 'Weight', 5.5, 'kg', NULL, '2026-01-02T09:00:00Z', NULL)",
    ).run()

    const data = getPersonExportData(db, 1)!
    const csv = administrationsToCsv(data.administrations)

    expect(csv).toBe(
      "recorded_at,medication_name,dosage,dosage_unit,comments,administered_by\r\n" +
      "2026-01-01T08:00:00Z,Paracetamol,2,Tabs,,\r\n",
    )
  })

  it("escapes commas, quotes, and newlines in CSV fields", () => {
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at, dosage, dosage_unit, comments) VALUES (1, 1, '2026-01-01T08:00:00Z', 2, 'Tabs', 'take with food, or milk')",
    ).run()
    const data = getPersonExportData(db, 1)!
    const csv = administrationsToCsv(data.administrations)
    expect(csv).toContain('"take with food, or milk"')
  })

  it("escapes a bare carriage return so it can't be mistaken for a row break", () => {
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at, dosage, dosage_unit, comments) VALUES (1, 1, '2026-01-01T08:00:00Z', 2, 'Tabs', ?)",
    ).run("line one\rline two")
    const data = getPersonExportData(db, 1)!
    const csv = administrationsToCsv(data.administrations)
    expect(csv).toContain('"line one\rline two"')
    // Exactly one real row terminator (header + the one data row).
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(2)
  })

  it("prefixes formula-leading CSV cells with a single quote so spreadsheets treat them as text", () => {
    const insert = db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at, dosage, dosage_unit, comments) VALUES (1, 1, ?, 2, 'Tabs', ?)",
    )
    insert.run("2026-01-01T08:00:00Z", "@SUM(1+1)")
    insert.run("2026-01-01T09:00:00Z", '=HYPERLINK("https://example.invalid/phish","Open")')
    insert.run("2026-01-01T10:00:00Z", "+cmd|' /C calc'!A0")
    insert.run("2026-01-01T11:00:00Z", "-1+1")
    insert.run("2026-01-01T12:00:00Z", "\t=cmd|' /C calc'!A0")

    const csv = administrationsToCsv(getPersonExportData(db, 1)!.administrations)
    expect(csv).toContain("'@SUM(1+1)")
    expect(csv).toContain(`"'=HYPERLINK(""https://example.invalid/phish"",""Open"")"`)
    expect(csv).toContain("'+cmd|' /C calc'!A0")
    expect(csv).toContain("'-1+1")
    expect(csv).toContain("'\t=cmd|' /C calc'!A0")
    expect(csv).not.toMatch(/(?:^|,)[=+\-@\t]/m)
  })

  it("produces an empty-but-valid CSV (header only) when there are no records", () => {
    expect(observationsToCsv([])).toBe("recorded_at,observation_type,value,unit,value_label,comments\r\n")
  })

  function addTestEvent(name: string, date: string, attachmentUrl: string | null = null, notes: string | null = null): number {
    return Number(db.prepare(
      "INSERT INTO test_events (person_id, test_type, name, date, ordered_by, notes, attachment_url) VALUES (1, 'Blood', ?, ?, 'Dr A', ?, ?)",
    ).run(name, date, notes, attachmentUrl).lastInsertRowid)
  }

  function addValue(eventId: number, metric: string, value: number, unit: string, qualifier: string | null = null) {
    db.prepare(
      "INSERT INTO test_result_values (test_event_id, metric_name, value_type, numeric_value, unit, reference_range, flag, limit_qualifier) VALUES (?, ?, 'numeric', ?, ?, '1 - 5', NULL, ?)",
    ).run(eventId, metric, value, unit, qualifier)
  }

  describe("test results and symptoms", () => {
    it("gathers test results with nested values, chronological with id as tie-break", () => {
      const late = addTestEvent("Late", "2026-03-01")
      const early = addTestEvent("Early", "2026-01-01", "/api/test-results/uploads/99999999-9999-4999-8999-999999999999.pdf")
      const sameDay = addTestEvent("Same day", "2026-01-01")
      addValue(early, "Iron", 12, "umol/L")
      addValue(early, "Ferritin", 30, "ug/L", "<")
      const data = getPersonExportData(db, 1)!
      expect(data.test_results.map(t => t.name)).toEqual(["Early", "Same day", "Late"])
      expect(data.test_results[0].attachment).toBe("99999999-9999-4999-8999-999999999999.pdf")
      expect(data.test_results[0].values.map(v => v.metric_name)).toEqual(["Iron", "Ferritin"])
      expect(data.test_results[0].values[1].limit_qualifier).toBe("<")
      expect(data.test_results[1].values).toEqual([])
      expect([early, sameDay, late]).toHaveLength(3)
    })

    it("scopes test results and symptoms to the one person", () => {
      db.prepare("INSERT INTO people (id, name) VALUES (2, 'Other')").run()
      db.prepare("INSERT INTO test_events (person_id, test_type, name, date) VALUES (2, 'Blood', 'Theirs', '2026-01-01')").run()
      db.prepare("INSERT INTO symptom_events (person_id, label, start_date, severity) VALUES (2, 'Cough', '2026-01-01', 2)").run()
      const data = getPersonExportData(db, 1)!
      expect(data.test_results).toEqual([])
      expect(data.symptoms).toEqual([])
    })

    it("test results CSV has one row per value with parent fields repeated, plus a row for an event with no values", () => {
      const withValues = addTestEvent("Iron Studies", "2026-01-01", "/api/test-results/uploads/99999999-9999-4999-8999-999999999999.pdf")
      addValue(withValues, "Iron", 12, "umol/L")
      addValue(withValues, "Ferritin", 30, "ug/L", "<")
      addTestEvent("No values", "2026-02-01")
      const csv = testResultsToCsv(getPersonExportData(db, 1)!.test_results)
      const lines = csv.split("\r\n").filter(Boolean)
      expect(lines[0]).toBe(
        "date,name,test_type,ordered_by,notes,attachment,metric_name,value_type,limit_qualifier,numeric_value,qualitative_value,unit,reference_range,flag",
      )
      expect(lines).toHaveLength(4)
      expect(lines[1]).toBe("2026-01-01,Iron Studies,Blood,Dr A,,99999999-9999-4999-8999-999999999999.pdf,Iron,numeric,,12,,umol/L,1 - 5,")
      expect(lines[2]).toContain("Ferritin,numeric,<,30")
      expect(lines[3]).toBe("2026-02-01,No values,Blood,Dr A,,,,,,,,,,")
    })

    it("escapes formula-leading test result cells", () => {
      addTestEvent("=SUM(A1)", "2026-01-01", null, "line, with comma")
      const csv = testResultsToCsv(getPersonExportData(db, 1)!.test_results)
      expect(csv).toContain("'=SUM(A1)")
      expect(csv).toContain('"line, with comma"')
    })

    it("gathers symptoms chronologically into a readable CSV", () => {
      db.prepare("INSERT INTO symptom_events (person_id, label, start_date, end_date, severity, is_resolved, resolved_at, notes) VALUES (1, 'Rash', '2026-02-01', '2026-02-03', 3, 1, '2026-02-03T10:00:00Z', 'on arm')").run()
      db.prepare("INSERT INTO symptom_events (person_id, label, start_date, severity) VALUES (1, 'Cough', '2026-01-01', 2)").run()
      const data = getPersonExportData(db, 1)!
      expect(data.symptoms.map(s => s.label)).toEqual(["Cough", "Rash"])
      expect(symptomsToCsv(data.symptoms)).toBe(
        "label,start_date,end_date,severity,is_resolved,resolved_at,notes\r\n" +
        "Cough,2026-01-01,,2,0,,\r\n" +
        "Rash,2026-02-01,2026-02-03,3,1,2026-02-03T10:00:00Z,on arm\r\n",
      )
    })

    it("a person with no test results or symptoms exports header-only CSVs", () => {
      const data = getPersonExportData(db, 1)!
      expect(testResultsToCsv(data.test_results).split("\r\n").filter(Boolean)).toHaveLength(1)
      expect(symptomsToCsv(data.symptoms).split("\r\n").filter(Boolean)).toHaveLength(1)
    })

    it("exports a symptom's dates as calendar dates, not the stored local-midnight timestamps", () => {
      // Local midnight of 3 and 5 Aug in UTC+10:30 is the evening of the day before in UTC.
      db.prepare("INSERT INTO symptom_events (person_id, label, start_date, end_date, severity) VALUES (1, 'Sore throat', '2026-08-02T14:30:00.000Z', '2026-08-04T14:30:00.000Z', 2)").run()
      const row = getPersonExportData(db, 1)!.symptoms.find(x => x.label === "Sore throat")!
      expect(row.start_date).toBe("2026-08-03")
      expect(row.end_date).toBe("2026-08-05")
    })

    it("exports symptom/dose links described by both records, for this person only", () => {
      db.prepare("INSERT INTO symptom_events (id, person_id, label, start_date, severity) VALUES (10, 1, 'Headache', '2026-02-01T00:00:00Z', 2)").run()
      const rec = Number(db.prepare("INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (1, 1, '2026-02-01T09:00:00Z')").run().lastInsertRowid)
      db.prepare("INSERT INTO symptom_dose_links (symptom_event_id, medication_record_id, person_id) VALUES (10, ?, 1)").run(rec)
      const data = getPersonExportData(db, 1)!
      expect(data.symptom_dose_links).toEqual([
        { symptom_label: "Headache", symptom_start_date: "2026-02-01T00:00:00Z", medication_name: "Paracetamol", dose_recorded_at: "2026-02-01T09:00:00Z" },
      ])
      expect(symptomDoseLinksToCsv(data.symptom_dose_links)).toBe(
        "symptom_label,symptom_start_date,medication_name,dose_recorded_at\r\nHeadache,2026-02-01T00:00:00Z,Paracetamol,2026-02-01T09:00:00Z\r\n",
      )
    })
  })
})
