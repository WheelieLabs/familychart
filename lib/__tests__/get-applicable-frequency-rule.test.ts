import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getApplicableFrequencyRule, type FrequencyRule } from "@/lib/frequency-rule"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE medication_frequency_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medication_id INTEGER,
      min_hours_between REAL NOT NULL,
      max_hours_between REAL,
      max_quantity_per_24h REAL,
      max_quantity_unit TEXT,
      max_per_24h_count_doses INTEGER NOT NULL DEFAULT 0,
      min_age_years REAL,
      max_age_years REAL,
      min_weight_kg REAL,
      max_weight_kg REAL,
      dosage REAL
    );
  `)
  return db
}

function insertRule(
  db: Database.Database,
  overrides: Partial<FrequencyRule> & { medication_id?: number | null }
): void {
  db.prepare(
    `INSERT INTO medication_frequency_rules
       (medication_id, min_hours_between, max_hours_between,
        max_quantity_per_24h, max_quantity_unit, max_per_24h_count_doses,
        min_age_years, max_age_years, min_weight_kg, max_weight_kg, dosage)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    overrides.medication_id ?? null,
    overrides.min_hours_between ?? 4,
    overrides.max_hours_between ?? null,
    overrides.max_quantity_per_24h ?? null,
    overrides.max_quantity_unit ?? null,
    overrides.max_per_24h_count_doses ?? 0,
    overrides.min_age_years ?? null,
    overrides.max_age_years ?? null,
    overrides.min_weight_kg ?? null,
    overrides.max_weight_kg ?? null,
    overrides.dosage ?? null
  )
}

describe("getApplicableFrequencyRule", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it("returns null when no rules exist for the medication", () => {
    expect(getApplicableFrequencyRule(db, 99, 8, 30)).toBeNull()
  })

  it("selects a medication-scoped rule by age band", () => {
    insertRule(db, { medication_id: 1, min_age_years: 0, max_age_years: 12, min_hours_between: 6 })
    insertRule(db, { medication_id: 1, min_age_years: 13, max_age_years: 18, min_hours_between: 4 })

    const rule = getApplicableFrequencyRule(db, 1, 8, null)
    expect(rule).not.toBeNull()
    expect(rule!.min_hours_between).toBe(6)
  })

  it("selects a medication-scoped rule by weight band", () => {
    insertRule(db, { medication_id: 1, min_weight_kg: 10, max_weight_kg: 30, min_hours_between: 8 })
    insertRule(db, { medication_id: 1, min_weight_kg: 40, max_weight_kg: 80, min_hours_between: 4 })

    const rule = getApplicableFrequencyRule(db, 1, null, 20)
    expect(rule).not.toBeNull()
    expect(rule!.min_hours_between).toBe(8)
  })
})
