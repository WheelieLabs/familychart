import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { validateObservationWrite } from "@/lib/observation/observation-validation"

function createDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
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
    INSERT INTO observation_type_config (observation_type, is_active)
    VALUES ('Hydration', 1), ('Retired', 0), ('Legacy Custom', 1);
  `)
  return db
}

describe("validateObservationWrite", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createDb()
  })

  afterEach(() => {
    db.close()
  })

  it("accepts active types with finite non-negative values", () => {
    const result = validateObservationWrite(db, { observation_type: "hydration", value: 250 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.observationType).toBe("Hydration")
      expect(result.value).toBe(250)
    }
  })

  it("rejects unknown types", () => {
    const result = validateObservationWrite(db, { observation_type: "Unknown", value: 1 })
    expect(result.ok).toBe(false)
  })

  it("rejects inactive types", () => {
    const result = validateObservationWrite(db, { observation_type: "Retired", value: 1 })
    expect(result.ok).toBe(false)
  })

  it("accepts grandfathered custom types that remain active", () => {
    const result = validateObservationWrite(db, { observation_type: "Legacy Custom", value: 42 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.observationType).toBe("Legacy Custom")
    }
  })

  it("rejects non-finite values", () => {
    const result = validateObservationWrite(db, { observation_type: "Hydration", value: NaN })
    expect(result.ok).toBe(false)
  })
})
