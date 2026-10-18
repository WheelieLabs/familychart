// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import Database from "better-sqlite3-multiple-ciphers"
import { MIGRATIONS, runMigrations } from "@/lib/db-migrations"
import { applyBaselineSchema } from "@/lib/db"

describe("schema migrations (1.0.0 baseline squash)", () => {
  it("a fresh database does not depend on any migration to become usable", () => {
    const db = new Database(":memory:")
    applyBaselineSchema(db)
    expect(() => runMigrations(db)).not.toThrow()
    expect(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'accounts'").get(),
    ).toBeTruthy()
    db.close()
  })

  it("is idempotent across repeated runs", () => {
    const db = new Database(":memory:")
    applyBaselineSchema(db)
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()
    db.close()
  })
})

describe("018_medication_records_administered_by", () => {
  it("adds administered_by to medication_records without touching existing rows", () => {
    const db = new Database(":memory:")
    // Simulate a pre-existing install: baseline minus the new column, with a real row already in it.
    db.exec(`
      CREATE TABLE people (id INTEGER PRIMARY KEY);
      CREATE TABLE medications (id INTEGER PRIMARY KEY);
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
    `)
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (1, 1, '2026-01-01T08:00:00.000Z')",
    ).run()

    runMigrations(db)

    const columns = (db.prepare("PRAGMA table_info(medication_records)").all() as { name: string }[]).map(
      c => c.name,
    )
    expect(columns).toContain("administered_by")
    const row = db.prepare("SELECT administered_by FROM medication_records").get() as {
      administered_by: string | null
    }
    expect(row.administered_by).toBeNull()
    db.close()
  })

  it("is a no-op on a fresh database that already has the column from applyBaselineSchema", () => {
    const db = new Database(":memory:")
    applyBaselineSchema(db)
    expect(() => runMigrations(db)).not.toThrow()
    const columns = (db.prepare("PRAGMA table_info(medication_records)").all() as { name: string }[]).map(
      c => c.name,
    )
    expect(columns).toContain("administered_by")
    db.close()
  })

  it("is idempotent when run twice against an already-migrated pre-existing install", () => {
    const db = new Database(":memory:")
    db.exec(`
      CREATE TABLE medication_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person_id INTEGER NOT NULL,
        medication_id INTEGER NOT NULL,
        recorded_at DATETIME NOT NULL
      );
    `)
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()
    db.close()
  })
})

describe("019_test_results", () => {
  it("creates test_metric_config/test_events/test_result_values on a pre-existing install", () => {
    const db = new Database(":memory:")
    // Simulate a pre-existing install: baseline minus the three new tables (medication_records
    // stubbed so 018, which runs first, doesn't fail against this simulated older schema).
    db.exec(`
      CREATE TABLE people (id INTEGER PRIMARY KEY);
      CREATE TABLE medication_records (id INTEGER PRIMARY KEY);
    `)

    runMigrations(db)

    for (const table of ["test_metric_config", "test_events", "test_result_values"]) {
      expect(
        db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
      ).toBeTruthy()
    }
    db.close()
  })

  it("is a no-op on a fresh database that already has the tables from applyBaselineSchema", () => {
    const db = new Database(":memory:")
    applyBaselineSchema(db)
    expect(() => runMigrations(db)).not.toThrow()
    expect(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'test_events'").get(),
    ).toBeTruthy()
    db.close()
  })

  it("is idempotent when run twice against an already-migrated pre-existing install", () => {
    const db = new Database(":memory:")
    db.exec(`
      CREATE TABLE people (id INTEGER PRIMARY KEY);
      CREATE TABLE medication_records (id INTEGER PRIMARY KEY);
    `)
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()
    db.close()
  })
})

describe("021_dose_expectations", () => {
  const tables = ["dose_expectations", "dose_expectation_exceptions", "dose_expectation_outcomes"]
  const has = (db: Database.Database, name: string) =>
    Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))

  it("creates the three tables on a pre-existing install", () => {
    const db = new Database(":memory:")
    db.exec(`
      CREATE TABLE people (id INTEGER PRIMARY KEY);
      CREATE TABLE medication_records (id INTEGER PRIMARY KEY);
      CREATE TABLE person_medications (id INTEGER PRIMARY KEY);
    `)
    runMigrations(db)
    for (const t of tables) expect(has(db, t)).toBe(true)
    db.close()
  })

  it("is a no-op on a fresh database and idempotent when run twice", () => {
    const db = new Database(":memory:")
    applyBaselineSchema(db)
    expect(() => runMigrations(db)).not.toThrow()
    expect(() => runMigrations(db)).not.toThrow()
    for (const t of tables) expect(has(db, t)).toBe(true)
    db.close()
  })

  it("cascades expectation deletes to exceptions and outcomes, and rejects unknown outcome statuses", () => {
    const db = new Database(":memory:")
    applyBaselineSchema(db)
    db.pragma("foreign_keys = ON")
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'A')").run()
    db.prepare("INSERT INTO medications (id, name) VALUES (1, 'M')").run()
    db.prepare("INSERT INTO person_medications (id, person_id, medication_id) VALUES (1, 1, 1)").run()
    db.prepare(
      "INSERT INTO dose_expectations (id, person_medication_id, slot_hhmm, start_date, end_date) VALUES (1, 1, '12:00', '2025-01-13', '2025-03-28')",
    ).run()
    db.prepare("INSERT INTO dose_expectation_exceptions (dose_expectation_id, local_ymd) VALUES (1, '2025-02-03')").run()
    db.prepare(
      "INSERT INTO dose_expectation_outcomes (dose_expectation_id, local_ymd, status) VALUES (1, '2025-01-15', 'confirmed_missed')",
    ).run()
    expect(() =>
      db.prepare("INSERT INTO dose_expectation_outcomes (dose_expectation_id, local_ymd, status) VALUES (1, '2025-01-16', 'bogus')").run(),
    ).toThrow()

    db.prepare("DELETE FROM dose_expectations WHERE id = 1").run()
    expect(db.prepare("SELECT COUNT(*) AS n FROM dose_expectation_exceptions").get()).toEqual({ n: 0 })
    expect(db.prepare("SELECT COUNT(*) AS n FROM dose_expectation_outcomes").get()).toEqual({ n: 0 })
    db.close()
  })
})

describe("applyBaselineSchema", () => {
  it("creates the live 1.0.0 schema — accounts and people.account_uid, not local_users", () => {
    const db = new Database(":memory:")
    applyBaselineSchema(db)

    expect(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'accounts'").get(),
    ).toBeTruthy()
    expect(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'local_users'").get(),
    ).toBeUndefined()

    const columns = (db.prepare("PRAGMA table_info(people)").all() as { name: string }[]).map(
      c => c.name,
    )
    expect(columns).toContain("account_uid")
    expect(columns).not.toContain("user_uid")

    const index = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get("idx_people_account_uid_unique")
    expect(index).toBeTruthy()

    db.close()
  })

  it("accounts carries the full live column set from the start", () => {
    const db = new Database(":memory:")
    applyBaselineSchema(db)
    const columns = (db.prepare("PRAGMA table_info(accounts)").all() as { name: string }[]).map(
      c => c.name,
    )
    for (const col of [
      "auth_method",
      "external_id",
      "status",
      "invite_token_hash",
      "invite_expires_at",
      "invite_revoked_at",
      "must_reset_password",
    ]) {
      expect(columns).toContain(col)
    }
    db.close()
  })

  it("enforces uniqueness on people.account_uid", () => {
    const db = new Database(":memory:")
    applyBaselineSchema(db)
    db.prepare("INSERT INTO people (name, account_uid) VALUES ('Ben', 'local:1')").run()
    db.prepare("INSERT INTO people (name, account_uid) VALUES ('Other', 'local:2')").run()
    expect(() =>
      db.prepare("UPDATE people SET account_uid = 'local:1' WHERE name = 'Other'").run(),
    ).toThrow(/SQLITE_CONSTRAINT_UNIQUE|UNIQUE constraint failed/)
    db.close()
  })

  it("is safe to apply twice on the same database (second getDb() open in one process)", () => {
    const db = new Database(":memory:")
    applyBaselineSchema(db)
    db.prepare(
      "INSERT INTO accounts (email, password_hash, role) VALUES ('a@example.com', 'h', 'admin')",
    ).run()
    db.prepare("INSERT INTO people (name, account_uid) VALUES ('Ben', 'local:1')").run()

    expect(() => applyBaselineSchema(db)).not.toThrow()

    expect((db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n).toBe(1)
    expect((db.prepare("SELECT COUNT(*) AS n FROM people").get() as { n: number }).n).toBe(1)
    db.close()
  })
})

describe("022_dose_expectation_outcome_slot_at", () => {
  const hasSlotAt = (db: Database.Database) =>
    (db.prepare("PRAGMA table_info(dose_expectation_outcomes)").all() as { name: string }[]).some(c => c.name === "slot_at")

  it("adds slot_at to an install that already has the 021 table", () => {
    const db = new Database(":memory:")
    db.exec(`
      CREATE TABLE people (id INTEGER PRIMARY KEY);
      CREATE TABLE medication_records (id INTEGER PRIMARY KEY);
      CREATE TABLE person_medications (id INTEGER PRIMARY KEY);
    `)
    runMigrations(db)
    expect(hasSlotAt(db)).toBe(true)
    db.close()
  })

  it("is a no-op on a fresh database and idempotent", () => {
    const db = new Database(":memory:")
    applyBaselineSchema(db)
    expect(() => runMigrations(db)).not.toThrow()
    expect(() => runMigrations(db)).not.toThrow()
    expect(hasSlotAt(db)).toBe(true)
    db.close()
  })
})

describe("024_symptom_events_notes", () => {
  it("adds notes to an install that already has symptom_events, and is idempotent", () => {
    const db = new Database(":memory:")
    db.exec(`
      CREATE TABLE people (id INTEGER PRIMARY KEY);
      CREATE TABLE medication_records (id INTEGER PRIMARY KEY);
    `)
    runMigrations(db)
    const cols = (db.prepare("PRAGMA table_info(symptom_events)").all() as { name: string }[]).map(c => c.name)
    expect(cols).toContain("notes")
    expect(() => runMigrations(db)).not.toThrow()
    db.close()
  })
})

describe("025_symptom_events_ongoing_confirmed_on", () => {
  it("adds ongoing_confirmed_on to an install that already has symptom_events, and is idempotent", () => {
    const db = new Database(":memory:")
    db.exec(`
      CREATE TABLE people (id INTEGER PRIMARY KEY);
      CREATE TABLE medication_records (id INTEGER PRIMARY KEY);
    `)
    runMigrations(db)
    const cols = (db.prepare("PRAGMA table_info(symptom_events)").all() as { name: string }[]).map(c => c.name)
    expect(cols).toContain("ongoing_confirmed_on")
    expect(() => runMigrations(db)).not.toThrow()
    db.close()
  })
})

describe("028_normalise_twice_daily_schedule_frequency", () => {
  function frequencyById(db: Database.Database): Record<number, string | null> {
    const rows = db
      .prepare("SELECT id, schedule_frequency FROM person_medications ORDER BY id")
      .all() as { id: number; schedule_frequency: string | null }[]
    return Object.fromEntries(rows.map(row => [row.id, row.schedule_frequency]))
  }

  it("rewrites a stored twice_daily schedule to daily, leaves a daily schedule unchanged, and a second run changes nothing", () => {
    const db = new Database(":memory:")
    db.exec(`
      CREATE TABLE person_medications (
        id INTEGER PRIMARY KEY,
        schedule_frequency TEXT
      );
    `)
    const twiceDailyJson = '{"kind":"twice_daily"}'
    const dailyJson = '{ "kind": "daily" }'
    db.prepare("INSERT INTO person_medications (id, schedule_frequency) VALUES (1, ?)").run(twiceDailyJson)
    db.prepare("INSERT INTO person_medications (id, schedule_frequency) VALUES (2, ?)").run(dailyJson)

    const migration = MIGRATIONS.find(m => m.id === "028_normalise_twice_daily_schedule_frequency")
    expect(migration).toBeDefined()
    migration!.up(db)

    const afterFirst = frequencyById(db)
    expect(JSON.parse(afterFirst[1]!).kind).toBe("daily")
    expect(afterFirst[2]).toBe(dailyJson)

    migration!.up(db)
    expect(frequencyById(db)).toEqual(afterFirst)
    db.close()
  })
})

describe("032_drop_schedule_reminder_suppressions", () => {
  const tableExists = (db: Database.Database) =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schedule_reminder_suppressions'").get()

  it("drops the table on an install that still has it, and is idempotent", () => {
    const db = new Database(":memory:")
    applyBaselineSchema(db)
    db.exec(`
      CREATE TABLE schedule_reminder_suppressions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person_medication_id INTEGER NOT NULL,
        local_ymd TEXT NOT NULL,
        slot_hhmm TEXT NOT NULL
      );
      CREATE INDEX idx_sched_supp_ymd ON schedule_reminder_suppressions(local_ymd);
      INSERT INTO schedule_reminder_suppressions (person_medication_id, local_ymd, slot_hhmm) VALUES (1, '2026-01-01', '08:00');
    `)
    runMigrations(db)
    expect(tableExists(db)).toBe(false)
    expect(() => runMigrations(db)).not.toThrow()
    db.close()
  })

  it("a fresh database never creates the table", () => {
    const db = new Database(":memory:")
    applyBaselineSchema(db)
    runMigrations(db)
    expect(tableExists(db)).toBe(false)
    db.close()
  })
})
