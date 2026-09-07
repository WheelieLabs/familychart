import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { validateObservationExpectation } from "@/lib/observation/observation-expectation-validation"
import { SETTING_LOCALE_DEFAULT_TIMEZONE } from "@/lib/settings/registry"

const ENV_KEY = "FC_DEFAULT_TIMEZONE"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE app_settings (
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (key)
    );
    CREATE TABLE observation_type_config (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      observation_type   TEXT NOT NULL UNIQUE,
      is_static          INTEGER NOT NULL DEFAULT 0,
      chart_type         TEXT,
      typical_unit       TEXT,
      sort_order         INTEGER NOT NULL DEFAULT 0,
      max_age_years      INTEGER,
      stale_after_hours  INTEGER,
      is_active          INTEGER NOT NULL DEFAULT 1
    );
  `)
  db.prepare(
    `INSERT INTO observation_type_config
      (observation_type, is_static, chart_type, typical_unit, sort_order, is_active)
     VALUES (?, 1, 'line', 'kg', 1, 1)`,
  ).run("Weight")
  return db
}

function baseExpectation(overrides: Record<string, unknown> = {}) {
  return {
    observation_type: "Weight",
    cadence: "daily",
    enabled: true,
    ...overrides,
  }
}

describe("validateObservationExpectation schedule tz defaulting", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    delete process.env[ENV_KEY]
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_LOCALE_DEFAULT_TIMEZONE,
      "Australia/Sydney",
      Date.now(),
    )
  })

  afterEach(() => {
    delete process.env[ENV_KEY]
    db?.close()
  })

  it("defaults enabled expectation tz to instance when omitted", () => {
    const result = validateObservationExpectation(db, baseExpectation(), null)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.row.tz).toBe("Australia/Sydney")
    }
  })

  it("keeps explicit body tz unchanged", () => {
    const result = validateObservationExpectation(
      db,
      baseExpectation({ tz: "Pacific/Auckland" }),
      null,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.row.tz).toBe("Pacific/Auckland")
    }
  })

  it("leaves tz null for disabled expectations when omitted", () => {
    const result = validateObservationExpectation(
      db,
      baseExpectation({ enabled: false }),
      null,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.row.tz).toBeNull()
    }
  })

  it("rejects invalid IANA tz", () => {
    const result = validateObservationExpectation(
      db,
      baseExpectation({ tz: "Not/A/Timezone" }),
      null,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe("Invalid timezone")
    }
  })
})
