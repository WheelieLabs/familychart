// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { describe, expect, it } from "vitest"
import { evaluateDashboardPersonStatus } from "@/lib/dashboard/dashboard-person-status"
import type { Person } from "@/lib/domain-types"
import type { CalendarContext } from "@/lib/calendar-context"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      full_name     TEXT,
      photo_url     TEXT,
      color         TEXT    NOT NULL DEFAULT '#256AA5',
      sort_order    INTEGER NOT NULL DEFAULT 0,
      is_active     INTEGER NOT NULL DEFAULT 1,
      account_uid   TEXT,
      date_of_birth TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE medication_groups (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      notes       TEXT,
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE medications (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      default_dosage  REAL,
      dosage_unit     TEXT    NOT NULL DEFAULT 'Tabs',
      notes           TEXT,
      min_age_years   INTEGER,
      max_age_years   INTEGER,
      is_active       INTEGER NOT NULL DEFAULT 1,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE medication_group_members (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      medication_id INTEGER NOT NULL REFERENCES medications(id),
      group_id      INTEGER NOT NULL REFERENCES medication_groups(id),
      UNIQUE(medication_id, group_id)
    );

    CREATE TABLE person_medications (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id           INTEGER NOT NULL REFERENCES people(id),
      medication_id       INTEGER NOT NULL REFERENCES medications(id),
      is_active           INTEGER NOT NULL DEFAULT 1,
      schedule_times       TEXT,
      schedule_frequency   TEXT,
      schedule_start_date  TEXT,
      schedule_end_date    TEXT,
      schedule_slots       TEXT,
      schedule_tz          TEXT,
      UNIQUE(person_id, medication_id)
    );

    CREATE TABLE medication_records (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id     INTEGER NOT NULL REFERENCES people(id),
      medication_id INTEGER NOT NULL REFERENCES medications(id),
      recorded_at   DATETIME NOT NULL,
      dosage        REAL,
      dosage_unit   TEXT,
      comments      TEXT,
      created_by    TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE observations (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id        INTEGER NOT NULL REFERENCES people(id),
      observation_type TEXT    NOT NULL,
      value            REAL    NOT NULL,
      unit             TEXT    NOT NULL,
      recorded_at      DATETIME NOT NULL,
      comments         TEXT,
      created_by       TEXT,
      session_id       TEXT,
      value_label      TEXT,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE medication_frequency_rules (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      medication_id           INTEGER REFERENCES medications(id),
      min_hours_between       REAL    NOT NULL,
      max_hours_between       REAL,
      max_quantity_per_24h    REAL,
      max_quantity_unit       TEXT,
      min_age_years           INTEGER,
      max_age_years           INTEGER,
      dosage                  REAL,
      min_weight_kg           REAL,
      max_weight_kg           REAL,
      max_per_24h_count_doses INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE person_observation_expectations (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id                   INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      observation_type          TEXT    NOT NULL,
      cadence                     TEXT    NOT NULL,
      interval_days               REAL,
      recurrence_day_of_month     INTEGER,
      recurrence_month            INTEGER,
      recurrence_day              INTEGER,
      recurrence_use_birthday     INTEGER NOT NULL DEFAULT 0,
      enabled                     INTEGER NOT NULL DEFAULT 1,
      due_time_hhmm               TEXT    NOT NULL DEFAULT '00:00',
      tz                          TEXT,
      UNIQUE(person_id, observation_type)
    );

    CREATE TABLE observation_type_config (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      observation_type TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      is_static        INTEGER NOT NULL DEFAULT 0,
      chart_type       TEXT    NOT NULL DEFAULT 'line',
      typical_unit     TEXT,
      sort_order       INTEGER NOT NULL DEFAULT 0,
      max_age_years    REAL,
      stale_after_hours REAL,
      is_active        INTEGER NOT NULL DEFAULT 1,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE observation_goals (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id        INTEGER NOT NULL,
      observation_type TEXT    NOT NULL,
      goal_type        TEXT    NOT NULL DEFAULT 'daily_min',
      target_value     REAL    NOT NULL,
      target_max       REAL,
      unit             TEXT    NOT NULL,
      is_active        INTEGER NOT NULL DEFAULT 1,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      target_date      TEXT,
      UNIQUE(person_id, observation_type, goal_type)
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

    CREATE TABLE prn_push_requests (
      medication_record_id INTEGER PRIMARY KEY REFERENCES medication_records(id) ON DELETE CASCADE,
      requested_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      remind_after_hours   REAL
    );

    CREATE TABLE app_settings (
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (key)
    );

    CREATE TABLE schedule_reminder_suppressions (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      person_medication_id  INTEGER NOT NULL REFERENCES person_medications(id),
      local_ymd             TEXT    NOT NULL,
      slot_hhmm             TEXT    NOT NULL,
      medication_record_id  INTEGER REFERENCES medication_records(id),
      created_by            TEXT,
      created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(person_medication_id, local_ymd, slot_hhmm)
    );

    CREATE TABLE user_settings (
      user_uid    TEXT NOT NULL,
      key         TEXT NOT NULL,
      value       TEXT NOT NULL,
      updated_at  INTEGER NOT NULL,
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

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: 1,
    name: "Test",
    full_name: null,
    photo_url: null,
    color: "#000",
    sort_order: 0,
    is_active: 1,
    account_uid: null,
    date_of_birth: null,
    ...overrides,
  }
}

const UTC_CALCTX: CalendarContext = { ymd: "2025-01-15", offsetMinutes: 0, ianaTz: "UTC" }

describe("evaluateDashboardPersonStatus", () => {
  it("returns an empty array when there are no people", () => {
    const db = createTestDb()
    const result = evaluateDashboardPersonStatus(db, [], { now: new Date("2025-01-15T12:00:00.000Z"), calCtx: UTC_CALCTX })
    expect(result).toEqual([])
  })

  it("reports green / all-clear for a person with nothing outstanding", () => {
    const db = createTestDb()
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()

    const [status] = evaluateDashboardPersonStatus(db, [person()], {
      now: new Date("2025-01-15T12:00:00.000Z"),
      calCtx: UTC_CALCTX,
    })

    expect(status.status).toBe("green")
    expect(status.message).toBe("All clear")
    expect(status.summary).toBe("All clear")
    expect(status.issues).toEqual([])
    expect(status.alerts).toEqual([])
  })

  it("escalates to red and surfaces an alert for an overdue scheduled medication", () => {
    const db = createTestDb()
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    db.prepare("INSERT INTO medications (id, name) VALUES (1, 'Paracetamol')").run()
    db.prepare(
      `INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_frequency, schedule_tz)
       VALUES (1, 1, 1, ?, ?, 'UTC')`,
    ).run(JSON.stringify(["10:00"]), JSON.stringify({ kind: "daily" }))

    // Within the slot's overdue grace window (10:00 slot, 30min offset + 30min window = 60min grace).
    const now = new Date("2025-01-15T10:45:00.000Z")

    const [status] = evaluateDashboardPersonStatus(db, [person()], { now, calCtx: UTC_CALCTX })

    expect(status.status).toBe("red")
    expect(status.issues).toEqual([expect.objectContaining({ kind: "prescription_overdue", medicationId: 1 })])
    expect(status.message).toContain("Paracetamol")
    expect(status.alerts).toHaveLength(1)
    expect(status.summary).toBe(status.alerts[0].short)
  })

  it("only reports issues that belong to the given person", () => {
    const db = createTestDb()
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice'), (2, 'Bob')").run()
    db.prepare("INSERT INTO medications (id, name) VALUES (1, 'Paracetamol')").run()
    db.prepare(
      `INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_frequency, schedule_tz)
       VALUES (1, 1, 1, ?, ?, 'UTC')`,
    ).run(JSON.stringify(["10:00"]), JSON.stringify({ kind: "daily" }))

    const now = new Date("2025-01-15T10:45:00.000Z")

    const [aliceStatus, bobStatus] = evaluateDashboardPersonStatus(
      db,
      [person({ id: 1, name: "Alice" }), person({ id: 2, name: "Bob" })],
      { now, calCtx: UTC_CALCTX },
    )

    expect(aliceStatus.status).toBe("red")
    expect(bobStatus.status).toBe("green")
    expect(bobStatus.issues).toEqual([])
  })

  it("appends a hydration pacing alert and escalates status from green to amber", () => {
    const db = createTestDb()
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    db.prepare(
      `INSERT INTO observation_goals (person_id, observation_type, target_value, unit)
       VALUES (1, 'Hydration', 2000, 'mL')`,
    ).run()
    // No hydration recorded yet today — well behind pace by midday.

    const now = new Date("2025-01-15T12:00:00.000Z")

    const [status] = evaluateDashboardPersonStatus(db, [person()], { now, calCtx: UTC_CALCTX })

    expect(status.status).toBe("amber")
    expect(status.hydration?.status).toBe("behind")
    expect(status.alerts).toHaveLength(1)
    expect(status.alerts[0]).toEqual(
      expect.objectContaining({
        severity: "amber",
        type: "observation",
        action_url: "/1/record-observation?type=Hydration",
      }),
    )
    expect(status.summary).toBe(status.alerts[0].short)
  })

  it("summarises multiple alerts with a count instead of the first alert's text", () => {
    const db = createTestDb()
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    db.prepare("INSERT INTO medications (id, name) VALUES (1, 'Paracetamol')").run()
    db.prepare(
      `INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_frequency, schedule_tz)
       VALUES (1, 1, 1, ?, ?, 'UTC')`,
    ).run(JSON.stringify(["10:00"]), JSON.stringify({ kind: "daily" }))
    db.prepare(
      `INSERT INTO observation_goals (person_id, observation_type, target_value, unit)
       VALUES (1, 'Hydration', 2000, 'mL')`,
    ).run()

    const now = new Date("2025-01-15T10:45:00.000Z")

    const [status] = evaluateDashboardPersonStatus(db, [person()], { now, calCtx: UTC_CALCTX })

    expect(status.alerts.length).toBeGreaterThan(1)
    expect(status.summary).toBe(`${status.alerts.length} active alerts`)
  })
})
