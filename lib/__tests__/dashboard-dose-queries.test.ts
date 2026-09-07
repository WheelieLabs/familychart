import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getTotalTaken24hForMed, getOldestIn24hWindow } from "@/lib/dashboard/dashboard-dose-queries"
import type { FrequencyRule } from "@/lib/domain-types"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE medications (id INTEGER PRIMARY KEY, name TEXT NOT NULL, dosage_unit TEXT);
    CREATE TABLE medication_groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE medication_group_members (group_id INTEGER NOT NULL, medication_id INTEGER NOT NULL);
    CREATE TABLE medication_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      medication_id INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      dosage REAL,
      dosage_unit TEXT
    );
  `)
  return db
}

function rule(overrides: Partial<FrequencyRule> = {}): FrequencyRule {
  return {
    id: 1,
    medication_id: 1,
    min_hours_between: 4,
    max_hours_between: null,
    max_quantity_per_24h: 3,
    max_quantity_unit: null,
    max_per_24h_count_doses: 1,
    min_age_years: null,
    max_age_years: null,
    min_weight_kg: null,
    max_weight_kg: null,
    dosage: null,
    ...overrides,
  }
}

describe("getTotalTaken24hForMed", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Test')").run()
    db.prepare("INSERT INTO medications (id, name, dosage_unit) VALUES (1, 'Med A', 'Tabs')").run()
    db.prepare("INSERT INTO medications (id, name, dosage_unit) VALUES (2, 'Med B', 'Tabs')").run()
    db.prepare("INSERT INTO medication_groups (id, name) VALUES (1, 'Group')").run()
    db.prepare("INSERT INTO medication_group_members (group_id, medication_id) VALUES (1, 1), (1, 2)").run()
    const recent = new Date().toISOString()
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at, dosage, dosage_unit) VALUES (1, 1, ?, 1, 'Tabs')",
    ).run(recent)
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at, dosage, dosage_unit) VALUES (1, 2, ?, 1, 'Tabs')",
    ).run(recent)
  })

  afterEach(() => {
    db.close()
  })

  it("counts only the requested medication_id, not group siblings", () => {
    expect(getTotalTaken24hForMed(db, 1, 1, rule(), "Tabs")).toBe(1)
    expect(getTotalTaken24hForMed(db, 1, 2, rule(), "Tabs")).toBe(1)
  })
})

describe("getOldestIn24hWindow", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Test')").run()
    db.prepare("INSERT INTO medications (id, name, dosage_unit) VALUES (1, 'Med A', 'Tabs')").run()
    db.prepare("INSERT INTO medications (id, name, dosage_unit) VALUES (2, 'Med B', 'Tabs')").run()
    db.prepare("INSERT INTO medication_groups (id, name) VALUES (1, 'Group')").run()
    db.prepare("INSERT INTO medication_group_members (group_id, medication_id) VALUES (1, 1), (1, 2)").run()
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (1, 1, datetime('now', '-2 hours'))",
    ).run()
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (1, 2, datetime('now', '-1 hour'))",
    ).run()
  })

  afterEach(() => {
    db.close()
  })

  it("returns oldest dose for the requested medication only", () => {
    const oldestMed1 = getOldestIn24hWindow(db, 1, 1)
    const oldestMed2 = getOldestIn24hWindow(db, 1, 2)
    expect(oldestMed1).not.toBeNull()
    expect(oldestMed2).not.toBeNull()
    expect(new Date(oldestMed1!).getTime()).toBeLessThan(new Date(oldestMed2!).getTime())
  })
})
