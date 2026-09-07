// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { describe, expect, it } from "vitest"
import { createHydrationEvaluator, type HydrationPersonRef } from "@/lib/hydration/hydration-evaluate"
import {
  HYDRATION_KEY_ACTIVE_END,
  HYDRATION_KEY_ACTIVE_START,
  HYDRATION_KEY_MUTED_UNTIL,
} from "@/lib/hydration/hydration-config"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      account_uid TEXT
    );
    CREATE TABLE observations (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id        INTEGER NOT NULL REFERENCES people(id),
      observation_type TEXT    NOT NULL,
      value            REAL    NOT NULL,
      unit             TEXT    NOT NULL,
      recorded_at      DATETIME NOT NULL,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE person_notification_prefs (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id           INTEGER NOT NULL REFERENCES people(id),
      user_uid            TEXT NOT NULL,
      notify_prn          INTEGER NOT NULL DEFAULT 1,
      notify_prescribed   INTEGER NOT NULL DEFAULT 1,
      notify_overdue      INTEGER NOT NULL DEFAULT 1,
      notify_observations INTEGER NOT NULL DEFAULT 0,
      notify_hydration    INTEGER NOT NULL DEFAULT 1,
      UNIQUE(person_id, user_uid)
    );
    CREATE TABLE app_settings (
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (key)
    );
    CREATE TABLE user_settings (
      user_uid   TEXT NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_uid, key)
    );
    CREATE TABLE audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email  TEXT,
      action      TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id   INTEGER,
      details     TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
  return db
}

function person(overrides: Partial<HydrationPersonRef> = {}): HydrationPersonRef {
  return { id: 1, account_uid: null, ...overrides }
}

const NOON_UTC = new Date("2025-01-15T12:00:00.000Z").getTime()
const DAY_CAL = { ymd: "2025-01-15", offsetMinutes: 0 }

describe("createHydrationEvaluator", () => {
  it("reports no_goal and skips pacing when goalMl is null", () => {
    const db = createTestDb()
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    const evaluator = createHydrationEvaluator(db, [person()], NOON_UTC)

    const result = evaluator.evaluate(person(), null, DAY_CAL)

    expect(result.hydration).toEqual({ total_ml: 0, goal_ml: null, percent: null, status: "no_goal" })
    expect(result.pacing).toBeNull()
  })

  it("reports before_window ahead of a configured active window with no consumption yet", () => {
    const db = createTestDb()
    db.prepare("INSERT INTO people (id, name, account_uid) VALUES (1, 'Alice', 'user-1')").run()
    db.prepare(
      `INSERT INTO user_settings (user_uid, key, value, updated_at) VALUES
         ('user-1', ?, '07:00', 0),
         ('user-1', ?, '21:00', 0)`,
    ).run(HYDRATION_KEY_ACTIVE_START, HYDRATION_KEY_ACTIVE_END)
    const p = person({ account_uid: "user-1" })
    const evaluator = createHydrationEvaluator(db, [p], new Date("2025-01-15T05:00:00.000Z").getTime())

    const result = evaluator.evaluate(p, 2000, DAY_CAL)

    expect(result.hydration.status).toBe("before_window")
    expect(result.hydration.total_ml).toBe(0)
  })

  it("falls back to a flat all-day window (no before_window) when the person has no linked account", () => {
    const db = createTestDb()
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    const evaluator = createHydrationEvaluator(db, [person()], new Date("2025-01-15T05:00:00.000Z").getTime())

    const result = evaluator.evaluate(person(), 2000, DAY_CAL)

    expect(result.hydration.status).not.toBe("before_window")
  })

  it("reports behind pace at midday with no hydration recorded", () => {
    const db = createTestDb()
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    const evaluator = createHydrationEvaluator(db, [person()], NOON_UTC)

    const result = evaluator.evaluate(person(), 2000, DAY_CAL)

    expect(result.hydration.status).toBe("behind")
    expect(result.pacing?.status).toBe("behind")
  })

  it("reports met once recorded intake reaches the goal, summing today's observations", () => {
    const db = createTestDb()
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    db.prepare(
      `INSERT INTO observations (person_id, observation_type, value, unit, recorded_at)
       VALUES (1, 'Hydration', 1500, 'mL', '2025-01-15T09:00:00.000Z'),
              (1, 'Hydration', 600, 'mL', '2025-01-15T10:00:00.000Z')`,
    ).run()
    const evaluator = createHydrationEvaluator(db, [person()], NOON_UTC)

    const result = evaluator.evaluate(person(), 2000, DAY_CAL)

    expect(result.hydration.total_ml).toBe(2100)
    expect(result.hydration.status).toBe("met")
  })

  it("only sums a given day's observations, excluding entries from other local days", () => {
    const db = createTestDb()
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    db.prepare(
      `INSERT INTO observations (person_id, observation_type, value, unit, recorded_at)
       VALUES (1, 'Hydration', 500, 'mL', '2025-01-14T23:00:00.000Z'),
              (1, 'Hydration', 400, 'mL', '2025-01-16T00:30:00.000Z'),
              (1, 'Hydration', 300, 'mL', '2025-01-15T11:00:00.000Z')`,
    ).run()
    const evaluator = createHydrationEvaluator(db, [person()], NOON_UTC)

    const result = evaluator.evaluate(person(), 2000, DAY_CAL)

    expect(result.hydration.total_ml).toBe(300)
  })

  it("converts litre-unit observations to millilitres in the daily total", () => {
    const db = createTestDb()
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    db.prepare(
      `INSERT INTO observations (person_id, observation_type, value, unit, recorded_at)
       VALUES (1, 'Hydration', 1.2, 'L', '2025-01-15T09:00:00.000Z')`,
    ).run()
    const evaluator = createHydrationEvaluator(db, [person()], NOON_UTC)

    const result = evaluator.evaluate(person(), 2000, DAY_CAL)

    expect(result.hydration.total_ml).toBe(1200)
  })

  it("surfaces hydrationMutedToday when a mute covers the evaluated local day", () => {
    const db = createTestDb()
    db.prepare("INSERT INTO people (id, name, account_uid) VALUES (1, 'Alice', 'user-1')").run()
    db.prepare(
      "INSERT INTO user_settings (user_uid, key, value, updated_at) VALUES ('user-1', ?, '2025-01-15', 0)",
    ).run(HYDRATION_KEY_MUTED_UNTIL)
    const evaluator = createHydrationEvaluator(db, [person({ account_uid: "user-1" })], NOON_UTC)

    const result = evaluator.evaluate(person({ account_uid: "user-1" }), 2000, DAY_CAL)

    expect(result.mutedToday).toBe(true)
    expect(result.hydration.hydrationMutedToday).toBe(true)
    // Pacing is still computed and reported even while muted; only the alert surfacing is suppressed downstream.
    expect(result.hydration.status).toBe("behind")
  })

  it("does not report muted when the mute date is before the evaluated local day", () => {
    const db = createTestDb()
    db.prepare("INSERT INTO people (id, name, account_uid) VALUES (1, 'Alice', 'user-1')").run()
    db.prepare(
      "INSERT INTO user_settings (user_uid, key, value, updated_at) VALUES ('user-1', ?, '2025-01-14', 0)",
    ).run(HYDRATION_KEY_MUTED_UNTIL)
    const evaluator = createHydrationEvaluator(db, [person({ account_uid: "user-1" })], NOON_UTC)

    const result = evaluator.evaluate(person({ account_uid: "user-1" }), 2000, DAY_CAL)

    expect(result.mutedToday).toBe(false)
    expect(result.hydration.hydrationMutedToday).toBe(false)
  })

  it("keeps each person's total isolated in a batch evaluation", () => {
    const db = createTestDb()
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice'), (2, 'Bob')").run()
    db.prepare(
      `INSERT INTO observations (person_id, observation_type, value, unit, recorded_at)
       VALUES (1, 'Hydration', 500, 'mL', '2025-01-15T09:00:00.000Z'),
              (2, 'Hydration', 1900, 'mL', '2025-01-15T09:00:00.000Z')`,
    ).run()
    const evaluator = createHydrationEvaluator(db, [person({ id: 1 }), person({ id: 2 })], NOON_UTC)

    const alice = evaluator.evaluate(person({ id: 1 }), 2000, DAY_CAL)
    const bob = evaluator.evaluate(person({ id: 2 }), 2000, DAY_CAL)

    expect(alice.hydration.total_ml).toBe(500)
    expect(bob.hydration.total_ml).toBe(1900)
  })
})
