import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  MAX_MEDICATION_DOSAGE,
  validateMedicationRecordWrite,
} from "@/lib/medication/medication-record-validation"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE medications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      dosage_unit TEXT NOT NULL DEFAULT 'Tabs',
      min_age_years INTEGER,
      max_age_years INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      date_of_birth TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE person_medications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      medication_id INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(person_id, medication_id)
    );
    CREATE TABLE app_settings (
      key TEXT NOT NULL PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  return db
}

function insertMed(
  db: Database.Database,
  unit = "Tabs",
  active = 1,
  ageBounds: { min?: number | null; max?: number | null } = {},
): number {
  const r = db
    .prepare(
      "INSERT INTO medications (name, dosage_unit, min_age_years, max_age_years, is_active) VALUES (?, ?, ?, ?, ?)",
    )
    .run("Paracetamol", unit, ageBounds.min ?? null, ageBounds.max ?? null, active)
  return Number(r.lastInsertRowid)
}

function insertPerson(db: Database.Database, dob: string | null = null): number {
  const r = db
    .prepare("INSERT INTO people (name, date_of_birth) VALUES (?, ?)")
    .run("Bec", dob)
  return Number(r.lastInsertRowid)
}

function linkPersonMed(db: Database.Database, personId: number, medId: number, active = 1): void {
  db.prepare(
    "INSERT INTO person_medications (person_id, medication_id, is_active) VALUES (?, ?, ?)",
  ).run(personId, medId, active)
}

/** Date-of-birth string that yields approximately the given age in years. */
function dobForAge(years: number): string {
  return new Date(Date.now() - years * 365.25 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

describe("validateMedicationRecordWrite", () => {
  let db: Database.Database
  beforeEach(() => { db = createTestDb() })
  afterEach(() => { db.close() })

  const NOW = new Date().toISOString()

  it("rejects an unknown medication", () => {
    const res = validateMedicationRecordWrite(db, { medication_id: 999, recorded_at: NOW })
    expect(res.ok).toBe(false)
  })

  it("rejects an inactive medication", () => {
    const id = insertMed(db, "Tabs", 0)
    const res = validateMedicationRecordWrite(db, { medication_id: id, recorded_at: NOW })
    expect(res.ok).toBe(false)
  })

  it("rejects a future recorded_at beyond skew", () => {
    const id = insertMed(db)
    const future = new Date(Date.now() + 60 * 60_000).toISOString()
    const res = validateMedicationRecordWrite(db, { medication_id: id, recorded_at: future })
    expect(res).toMatchObject({ ok: false })
  })

  it("allows backdated history but rejects implausibly old timestamps", () => {
    const id = insertMed(db)
    expect(validateMedicationRecordWrite(db, {
      medication_id: id, recorded_at: "2020-01-01T08:00:00Z",
    }).ok).toBe(true)
    expect(validateMedicationRecordWrite(db, {
      medication_id: id, recorded_at: "1850-01-01T00:00:00Z",
    }).ok).toBe(false)
  })

  it("rejects negative, zero, NaN and out-of-range dosage", () => {
    const id = insertMed(db)
    for (const dosage of [-1000, 0, "abc", MAX_MEDICATION_DOSAGE + 1]) {
      expect(validateMedicationRecordWrite(db, { medication_id: id, recorded_at: NOW, dosage }).ok).toBe(false)
    }
  })

  it("allows an omitted dosage (dose-count tracking)", () => {
    const id = insertMed(db)
    const res = validateMedicationRecordWrite(db, { medication_id: id, recorded_at: NOW, dosage: null })
    expect(res).toMatchObject({ ok: true, dosage: null })
  })

  it("normalises a mis-cased unit to the catalogue casing", () => {
    const id = insertMed(db, "Tabs")
    const res = validateMedicationRecordWrite(db, {
      medication_id: id, recorded_at: NOW, dosage: 1, dosage_unit: "tabs",
    })
    expect(res).toMatchObject({ ok: true, dosageUnit: "Tabs", dosageUnitMismatch: false })
  })

  it("defaults an omitted unit to the catalogue unit", () => {
    const id = insertMed(db, "mL")
    const res = validateMedicationRecordWrite(db, { medication_id: id, recorded_at: NOW, dosage: 5 })
    expect(res).toMatchObject({ ok: true, dosageUnit: "mL", dosageUnitMismatch: false })
  })

  it("rejects an unrecognised unit", () => {
    const id = insertMed(db, "mg")
    const res = validateMedicationRecordWrite(db, {
      medication_id: id, recorded_at: NOW, dosage: 500, dosage_unit: "mgs",
    })
    expect(res.ok).toBe(false)
  })

  it("accepts a different but recognised catalogue unit, flagging the mismatch", () => {
    const id = insertMed(db, "Tabs")
    const res = validateMedicationRecordWrite(db, {
      medication_id: id, recorded_at: NOW, dosage: 1, dosage_unit: "applications",
    })
    expect(res).toMatchObject({ ok: true, dosageUnit: "applications", dosageUnitMismatch: true })
  })

  it("accepts a provided unit when the catalogue unit is blank", () => {
    const id = insertMed(db, "")
    const res = validateMedicationRecordWrite(db, {
      medication_id: id, recorded_at: NOW, dosage: 1, dosage_unit: "mg",
    })
    expect(res).toMatchObject({ ok: true, dosageUnit: "mg" })
  })

  describe("person↔medication linkage", () => {
    it("rejects a dose against a medication not linked to the person", () => {
      const personId = insertPerson(db)
      const medId = insertMed(db)
      const res = validateMedicationRecordWrite(db, {
        medication_id: medId, recorded_at: NOW, dosage: 1, person_id: personId,
      })
      expect(res).toMatchObject({ ok: false })
    })

    it("accepts a dose when an active person_medications link exists", () => {
      const personId = insertPerson(db)
      const medId = insertMed(db)
      linkPersonMed(db, personId, medId)
      const res = validateMedicationRecordWrite(db, {
        medication_id: medId, recorded_at: NOW, dosage: 1, person_id: personId,
      })
      expect(res.ok).toBe(true)
    })

    it("rejects when the link is inactive", () => {
      const personId = insertPerson(db)
      const medId = insertMed(db)
      linkPersonMed(db, personId, medId, 0)
      const res = validateMedicationRecordWrite(db, {
        medication_id: medId, recorded_at: NOW, dosage: 1, person_id: personId,
      })
      expect(res).toMatchObject({ ok: false })
    })

    it("skips the link requirement when requirePersonLink is false (import)", () => {
      const personId = insertPerson(db)
      const medId = insertMed(db)
      const res = validateMedicationRecordWrite(
        db,
        { medication_id: medId, recorded_at: NOW, dosage: 1, person_id: personId },
        { requirePersonLink: false },
      )
      expect(res.ok).toBe(true)
    })

    it("rejects an age-restricted medication for an out-of-range person", () => {
      const personId = insertPerson(db, dobForAge(4))
      const medId = insertMed(db, "Tabs", 1, { min: 12 })
      linkPersonMed(db, personId, medId)
      const res = validateMedicationRecordWrite(db, {
        medication_id: medId, recorded_at: NOW, dosage: 1, person_id: personId,
      })
      expect(res).toMatchObject({ ok: false })
    })

    it("enforces age bounds on the import path too", () => {
      const personId = insertPerson(db, dobForAge(90))
      const medId = insertMed(db, "Tabs", 1, { max: 65 })
      const res = validateMedicationRecordWrite(
        db,
        { medication_id: medId, recorded_at: NOW, dosage: 1, person_id: personId },
        { requirePersonLink: false },
      )
      expect(res).toMatchObject({ ok: false })
    })

    it("accepts an age-eligible person", () => {
      const personId = insertPerson(db, dobForAge(30))
      const medId = insertMed(db, "Tabs", 1, { min: 12, max: 65 })
      linkPersonMed(db, personId, medId)
      const res = validateMedicationRecordWrite(db, {
        medication_id: medId, recorded_at: NOW, dosage: 1, person_id: personId,
      })
      expect(res.ok).toBe(true)
    })
  })
})
