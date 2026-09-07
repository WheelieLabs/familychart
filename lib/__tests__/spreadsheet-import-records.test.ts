import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { importRecords, type MedicationImportRecord, type ObservationImportRecord } from "@/lib/spreadsheet-import"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      date_of_birth TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE medications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      dosage_unit TEXT NOT NULL DEFAULT 'Tabs',
      min_age_years INTEGER,
      max_age_years INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE person_medications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      medication_id INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(person_id, medication_id)
    );
    CREATE TABLE medication_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      medication_id INTEGER NOT NULL,
      recorded_at DATETIME NOT NULL,
      dosage REAL,
      dosage_unit TEXT,
      comments TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      observation_type TEXT NOT NULL,
      value REAL NOT NULL,
      unit TEXT NOT NULL,
      recorded_at DATETIME NOT NULL,
      comments TEXT,
      created_by TEXT,
      session_id TEXT,
      value_label TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE observation_type_config (
      id INTEGER PRIMARY KEY,
      observation_type TEXT NOT NULL,
      is_static INTEGER NOT NULL DEFAULT 0,
      chart_type TEXT,
      typical_unit TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      max_age_years INTEGER,
      stale_after_hours INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO observation_type_config (observation_type, typical_unit, is_active)
    VALUES ('Weight', 'kg', 1), ('Blood Pressure', 'mmHg', 1);
    CREATE TABLE prn_push_requests (
      medication_record_id INTEGER PRIMARY KEY REFERENCES medication_records(id) ON DELETE CASCADE,
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      remind_after_hours REAL
    );
    CREATE TABLE medication_group_members (group_id INTEGER NOT NULL, medication_id INTEGER NOT NULL);
  `)
  return db
}

function medRow(over: Partial<MedicationImportRecord> = {}): MedicationImportRecord {
  return {
    date: "2024-01-01",
    time: "08:00",
    medication_name: "Paracetamol",
    dosage: 1,
    dosage_unit: "Tabs",
    weight_kg: null,
    comments: null,
    ...over,
  }
}

describe("importRecords catalogue role gating", () => {
  let db: Database.Database
  let personId: number
  beforeEach(() => {
    db = createTestDb()
    personId = Number(db.prepare("INSERT INTO people (name) VALUES (?)").run("Bec").lastInsertRowid)
  })
  afterEach(() => db.close())

  function medCount(): number {
    return (db.prepare("SELECT COUNT(*) AS n FROM medications").get() as { n: number }).n
  }

  it("rejects unknown medications for a non-catalogue caller without creating a row", () => {
    const res = importRecords(db, personId, [medRow({ medication_name: "INJECT-0001" })], "u@x", false)
    expect(res.imported).toBe(0)
    expect(res.errors).toHaveLength(1)
    expect(medCount()).toBe(0)
  })

  it("creates the catalogue row and assigns the medication for a catalogue caller", () => {
    const res = importRecords(db, personId, [medRow({ medication_name: "Ibuprofen" })], "u@x", true)
    expect(res.imported).toBe(1)
    expect(medCount()).toBe(1)
    const link = db
      .prepare("SELECT 1 FROM person_medications WHERE person_id = ? AND is_active = 1")
      .get(personId)
    expect(link).toBeTruthy()
  })

  it("imports against an existing medication even for a non-catalogue caller", () => {
    db.prepare("INSERT INTO medications (name, dosage_unit) VALUES (?, ?)").run("Paracetamol", "Tabs")
    const res = importRecords(db, personId, [medRow()], "u@x", false)
    expect(res.imported).toBe(1)
    expect(medCount()).toBe(1)
  })

  it("leaves no orphan medication when a new row fails validation", () => {
    const res = importRecords(
      db,
      personId,
      [medRow({ medication_name: "BadDate", date: "not-a-date", time: null })],
      "u@x",
      true,
    )
    expect(res.imported).toBe(0)
    expect(res.errors).toHaveLength(1)
    expect(medCount()).toBe(0)
  })

  it("rejects an age-restricted existing medication for an out-of-range person", () => {
    const dob = new Date(Date.now() - 4 * 365.25 * 864e5).toISOString().slice(0, 10)
    db.prepare("UPDATE people SET date_of_birth = ? WHERE id = ?").run(dob, personId)
    db.prepare(
      "INSERT INTO medications (name, dosage_unit, min_age_years) VALUES (?, ?, ?)",
    ).run("AdultOnly", "Tabs", 12)
    const res = importRecords(db, personId, [medRow({ medication_name: "AdultOnly" })], "u@x", false)
    expect(res.imported).toBe(0)
    expect(res.errors).toHaveLength(1)
  })

  it("reactivates a soft-deleted person_medications link and audits via import", () => {
    const medId = Number(
      db.prepare("INSERT INTO medications (name, dosage_unit) VALUES (?, ?)").run("Paracetamol", "Tabs")
        .lastInsertRowid,
    )
    db.prepare(
      "INSERT INTO person_medications (person_id, medication_id, is_active) VALUES (?, ?, 0)",
    ).run(personId, medId)

    const res = importRecords(db, personId, [medRow()], "u@x", false)
    expect(res.imported).toBe(1)

    const link = db
      .prepare(
        "SELECT is_active FROM person_medications WHERE person_id = ? AND medication_id = ?",
      )
      .get(personId, medId) as { is_active: number }
    expect(link.is_active).toBe(1)

    const audit = db
      .prepare(
        "SELECT action, details FROM audit_log WHERE entity_type = 'person_medications' ORDER BY id DESC LIMIT 1",
      )
      .get() as { action: string; details: string }
    expect(audit.action).toBe("UPDATE")
    expect(JSON.parse(audit.details).via).toBe("import")
  })
})

function obsRow(over: Partial<ObservationImportRecord> = {}): ObservationImportRecord {
  return {
    record_type: "observation",
    date: "2024-01-01",
    time: "08:00",
    observation_type: "Weight",
    value: 12.5,
    unit: "kg",
    comments: null,
    ...over,
  }
}

describe("importRecords observation recorded_at bounds", () => {
  let db: Database.Database
  let personId: number
  beforeEach(() => {
    db = createTestDb()
    personId = Number(db.prepare("INSERT INTO people (name) VALUES (?)").run("Bec").lastInsertRowid)
  })
  afterEach(() => db.close())

  it("rejects a future observation recorded_at", () => {
    const res = importRecords(db, personId, [obsRow({ date: "2099-01-01" })], "u@x", false)
    expect(res.observationsCreated).toBe(0)
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]).toMatch(/future/)
  })

  it("rejects an implausibly old observation recorded_at", () => {
    const res = importRecords(db, personId, [obsRow({ date: "1850-01-01" })], "u@x", false)
    expect(res.observationsCreated).toBe(0)
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]).toMatch(/implausibly old/)
  })

  it("accepts an in-range historical observation recorded_at", () => {
    const res = importRecords(db, personId, [obsRow({ date: "2020-01-01" })], "u@x", false)
    expect(res.errors).toEqual([])
    expect(res.observationsCreated).toBe(1)
  })
})

