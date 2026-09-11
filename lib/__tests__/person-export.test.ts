import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtempSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { execFileSync } from "child_process"
import {
  getPersonExportData,
  administrationsToCsv,
  observationsToCsv,
  personExportJson,
  buildPersonExportZip,
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
      recorded_at TEXT NOT NULL, dosage REAL, dosage_unit TEXT, comments TEXT
    );
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL, observation_type TEXT NOT NULL,
      value REAL NOT NULL, unit TEXT NOT NULL, value_label TEXT,
      recorded_at TEXT NOT NULL, comments TEXT
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
      "INSERT INTO medication_records (person_id, medication_id, recorded_at, dosage, dosage_unit, comments) VALUES (1, 1, '2026-01-01T08:00:00Z', 2, 'Tabs', 'with food')",
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
      { recorded_at: "2026-01-01T08:00:00Z", medication_name: "Paracetamol", dosage: 2, dosage_unit: "Tabs", comments: "with food" },
    ])
    // Both units preserved as recorded — no conversion to a common unit.
    expect(data.observations.map(o => o.unit)).toEqual(["kg", "lb"])
  })

  it("CSV and JSON exports carry the same record content (parity)", () => {
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at, dosage, dosage_unit, comments) VALUES (1, 1, '2026-01-01T08:00:00Z', 2, 'Tabs', NULL)",
    ).run()
    db.prepare(
      "INSERT INTO observations (person_id, observation_type, value, unit, value_label, recorded_at, comments) VALUES (1, 'Weight', 5.5, 'kg', NULL, '2026-01-02T09:00:00Z', NULL)",
    ).run()

    const data = getPersonExportData(db, 1)!
    const csv = administrationsToCsv(data.administrations)
    const json = JSON.parse(personExportJson(data))

    expect(csv).toBe(
      "recorded_at,medication_name,dosage,dosage_unit,comments\r\n" +
      "2026-01-01T08:00:00Z,Paracetamol,2,Tabs,\r\n",
    )
    expect(json.administrations).toEqual(data.administrations)
    expect(json.observations).toEqual(data.observations)
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

  function listZipEntries(buffer: Buffer): string[] {
    const dir = mkdtempSync(join(tmpdir(), "fc-export-zip-"))
    const zipPath = join(dir, "export.zip")
    writeFileSync(zipPath, buffer)
    const output = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
    return output.trim().split("\n")
  }

  it("zip includes data CSVs, JSON, and the person photo attachment when present", async () => {
    const data = getPersonExportData(db, 1)!
    const zip = await buildPersonExportZip(data, { filename: "pat.jpg", buffer: Buffer.from("fake-jpeg-bytes") })
    const entries = listZipEntries(zip)
    expect(entries.sort()).toEqual([
      "attachments/pat.jpg",
      "data.json",
      "data/administrations.csv",
      "data/observations.csv",
    ])
  })

  it("zip omits attachments/ entirely when the person has no photo", async () => {
    const data = getPersonExportData(db, 1)!
    const zip = await buildPersonExportZip(data, null)
    const entries = listZipEntries(zip)
    expect(entries.some(e => e.startsWith("attachments/"))).toBe(false)
    expect(entries.sort()).toEqual(["data.json", "data/administrations.csv", "data/observations.csv"])
  })
})
