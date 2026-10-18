// SPDX-License-Identifier: AGPL-3.0-only

import { DOSE_EXPECTATION_TABLES_SQL } from "@/lib/__tests__/dose-expectation-fixtures"
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
      schedule_created_at_ms INTEGER,
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
  db.exec(DOSE_EXPECTATION_TABLES_SQL)
  db.exec(`
    CREATE TABLE symptom_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, person_id INTEGER NOT NULL, label TEXT NOT NULL,
      start_date TEXT NOT NULL, end_date TEXT, severity INTEGER NOT NULL DEFAULT 2,
      is_resolved INTEGER NOT NULL DEFAULT 0, resolved_at TEXT, notes TEXT, ongoing_confirmed_on TEXT
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

  describe("24h maximum alert for a once-a-day medication", () => {
    function seed(scheduled: boolean, maxQty: number) {
      const db = createTestDb()
      db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
      db.prepare("INSERT INTO medications (id, name) VALUES (1, 'Levothyroxine')").run()
      if (scheduled) {
        db.prepare(
          `INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_frequency, schedule_tz)
           VALUES (1, 1, 1, ?, ?, 'UTC')`,
        ).run(JSON.stringify(["03:00"]), JSON.stringify({ kind: "daily" }))
      } else {
        db.prepare("INSERT INTO person_medications (id, person_id, medication_id) VALUES (1, 1, 1)").run()
      }
      db.prepare(
        `INSERT INTO medication_frequency_rules (medication_id, min_hours_between, max_quantity_per_24h, max_per_24h_count_doses)
         VALUES (1, 0, ?, 1)`,
      ).run(maxQty)
      for (let i = 1; i <= maxQty; i++) {
        db.prepare(
          "INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (1, 1, datetime('now', ?))",
        ).run(`-${i} hours`)
      }
      return db
    }
    const kindsFor = (db: ReturnType<typeof createTestDb>) => {
      const now = new Date()
      const [status] = evaluateDashboardPersonStatus(db, [person()], {
        now,
        calCtx: { ymd: now.toISOString().slice(0, 10), offsetMinutes: 0, ianaTz: "UTC" },
      })
      return (status.issues ?? []).map(i => i.kind)
    }

    it("raises no at-max alert for a scheduled once-a-day medication after its dose", () => {
      expect(kindsFor(seed(true, 1))).not.toContain("prn_at_cap")
    })

    it("still raises it when the medication is not scheduled", () => {
      expect(kindsFor(seed(false, 1))).toContain("prn_at_cap")
    })

    it("still raises it when a scheduled medication allows two doses a day", () => {
      expect(kindsFor(seed(true, 2))).toContain("prn_at_cap")
    })
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

  describe("medicationTimeline", () => {
    it("is empty when no medication qualifies", () => {
      const db = createTestDb()
      db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
      const [status] = evaluateDashboardPersonStatus(db, [person()], {
        now: new Date("2025-01-15T12:00:00.000Z"),
        calCtx: UTC_CALCTX,
      })
      expect(status.medicationTimeline).toEqual([])
    })

    it("plots a scheduled medication's taken dose and its next upcoming slot", () => {
      const db = createTestDb()
      db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
      db.prepare("INSERT INTO medications (id, name) VALUES (1, 'Amoxicillin')").run()
      db.prepare(
        `INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_frequency, schedule_tz)
         VALUES (1, 1, 1, ?, ?, 'UTC')`,
      ).run(JSON.stringify(["10:00", "14:00"]), JSON.stringify({ kind: "daily" }))
      db.prepare(
        "INSERT INTO medication_records (id, person_id, medication_id, recorded_at) VALUES (5, 1, 1, '2025-01-15T10:05:00.000Z')",
      ).run()
      db.prepare(
        `INSERT INTO slot_outcomes (person_medication_id, local_ymd, slot_hhmm, result, offset_minutes, medication_record_id)
         VALUES (1, '2025-01-15', '10:00', 'on_time', 5, 5)`,
      ).run()

      const [status] = evaluateDashboardPersonStatus(db, [person()], {
        now: new Date("2025-01-15T12:00:00.000Z"),
        calCtx: UTC_CALCTX,
      })

      expect(status.medicationTimeline).toHaveLength(1)
      const lane = status.medicationTimeline![0]
      expect(lane).toEqual(expect.objectContaining({ medicationId: 1, name: "Amoxicillin", kind: "scheduled" }))
      // Yesterday's unlogged 14:00 slot is still inside the trailing window, so it shows as overdue.
      expect(lane.markers.map((m) => [m.kind, m.atIso])).toEqual([
        ["overdue", "2025-01-14T14:00:00.000Z"],
        ["taken", "2025-01-15T10:05:00.000Z"],
        ["upcoming", "2025-01-15T14:00:00.000Z"],
      ])
      expect(lane.markers[1]).toEqual(expect.objectContaining({ feedRowId: "med:5", flag: null }))
    })

    it("shows an open slot past its time as an overdue marker", () => {
      const db = createTestDb()
      db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
      db.prepare("INSERT INTO medications (id, name) VALUES (1, 'Amoxicillin')").run()
      db.prepare(
        `INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_frequency, schedule_tz)
         VALUES (1, 1, 1, ?, ?, 'UTC')`,
      ).run(JSON.stringify(["10:00"]), JSON.stringify({ kind: "daily" }))

      const [status] = evaluateDashboardPersonStatus(db, [person()], {
        now: new Date("2025-01-15T10:45:00.000Z"),
        calCtx: UTC_CALCTX,
      })

      const overdue = status.medicationTimeline![0].markers.filter((m) => m.kind === "overdue")
      expect(overdue).toEqual([{ kind: "overdue", atIso: "2025-01-15T10:00:00.000Z", flag: null }])
    })

    it("flags a taken scheduled dose by the timing stored against its slot", () => {
      const db = createTestDb()
      db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
      db.prepare("INSERT INTO medications (id, name) VALUES (1, 'Amoxicillin')").run()
      db.prepare(
        `INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_frequency, schedule_tz)
         VALUES (1, 1, 1, ?, ?, 'UTC')`,
      ).run(JSON.stringify(["08:00"]), JSON.stringify({ kind: "daily" }))
      db.prepare(
        "INSERT INTO medication_records (id, person_id, medication_id, recorded_at) VALUES (9, 1, 1, '2025-01-15T08:45:00.000Z')",
      ).run()
      db.prepare(
        `INSERT INTO slot_outcomes (person_medication_id, local_ymd, slot_hhmm, result, offset_minutes, medication_record_id)
         VALUES (1, '2025-01-15', '08:00', 'late', 45, 9)`,
      ).run()

      const [status] = evaluateDashboardPersonStatus(db, [person()], {
        now: new Date("2025-01-15T12:00:00.000Z"),
        calCtx: UTC_CALCTX,
      })

      const taken = status.medicationTimeline![0].markers.find((m) => m.kind === "taken")
      expect(taken?.flag).toEqual({ level: "amber", label: "45 min late" })
    })

    it("lists a Missed slot as quiet information: no alert, no issue, status unchanged", () => {
      const db = createTestDb()
      db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
      db.prepare("INSERT INTO medications (id, name) VALUES (1, 'Amoxicillin')").run()
      db.prepare(
        `INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_frequency, schedule_tz)
         VALUES (1, 1, 1, ?, ?, 'UTC')`,
      ).run(JSON.stringify(["08:00", "20:00"]), JSON.stringify({ kind: "daily" }))
      db.prepare(
        `INSERT INTO slot_outcomes (person_medication_id, local_ymd, slot_hhmm, result, missed_cause, created_at)
         VALUES (1, '2025-01-15', '08:00', 'missed', 'timed_out', '2025-01-15 12:00:05')`,
      ).run()

      const [status] = evaluateDashboardPersonStatus(db, [person()], {
        now: new Date("2025-01-15T13:00:00.000Z"),
        calCtx: UTC_CALCTX,
      })

      expect(status.missedSlots).toEqual([{ id: 1, medicationName: "Amoxicillin", slotHhmm: "08:00", day: "today" }])
      expect(status.alerts).toEqual([])
      expect(status.issues).toEqual([])
      expect(status.status).toBe("green")
    })

    it("builds a PRN lane with a cooldown band from real dose state", () => {
      const db = createTestDb()
      const now = new Date()
      const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString()
      db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
      db.prepare("INSERT INTO medications (id, name) VALUES (1, 'Ibuprofen')").run()
      db.prepare("INSERT INTO person_medications (id, person_id, medication_id) VALUES (1, 1, 1)").run()
      db.prepare(
        `INSERT INTO medication_frequency_rules (medication_id, min_hours_between, max_quantity_per_24h, max_per_24h_count_doses)
         VALUES (1, 6, 3, 1)`,
      ).run()
      db.prepare(
        "INSERT INTO medication_records (id, person_id, medication_id, recorded_at) VALUES (1, 1, 1, ?)",
      ).run(ago(2))

      const [status] = evaluateDashboardPersonStatus(db, [person()], {
        now,
        calCtx: { ymd: now.toISOString().slice(0, 10), offsetMinutes: 0, ianaTz: "UTC" },
      })

      const lane = status.medicationTimeline![0]
      expect(lane.kind).toBe("prn")
      expect(lane.cooldown).toEqual({ startIso: ago(2), endIso: new Date(new Date(ago(2)).getTime() + 6 * 3_600_000).toISOString() })
      expect(lane.markers.map((m) => m.kind)).toEqual(["taken", "next_eligible"])
    })

    it("only includes the given person's medications", () => {
      const db = createTestDb()
      db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice'), (2, 'Bob')").run()
      db.prepare("INSERT INTO medications (id, name) VALUES (1, 'Amoxicillin')").run()
      db.prepare("INSERT INTO person_medications (id, person_id, medication_id) VALUES (1, 1, 1), (2, 2, 1)").run()
      db.prepare(
        "INSERT INTO medication_records (id, person_id, medication_id, recorded_at) VALUES (1, 1, 1, '2025-01-15T10:00:00.000Z')",
      ).run()
      const [alice, bob] = evaluateDashboardPersonStatus(
        db,
        [person({ id: 1, name: "Alice" }), person({ id: 2, name: "Bob" })],
        { now: new Date("2025-01-15T12:00:00.000Z"), calCtx: UTC_CALCTX },
      )
      expect(alice.medicationTimeline).toHaveLength(1)
      expect(bob.medicationTimeline).toEqual([])
    })
  })

  describe("dose expectations", () => {
    function seedSchoolDose(db: Database.Database) {
      db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
      db.prepare("INSERT INTO medications (id, name, default_dosage) VALUES (1, 'Methylphenidate', 1)").run()
      db.prepare(
        `INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_frequency, schedule_tz)
         VALUES (1, 1, 1, ?, ?, 'UTC')`,
      ).run(JSON.stringify(["12:00"]), JSON.stringify({ kind: "daily" }))
      db.prepare(
        `INSERT INTO dose_expectations (id, person_medication_id, slot_hhmm, start_date, end_date)
         VALUES (1, 1, '12:00', '2025-01-13', '2025-03-28')`,
      ).run()
    }

    it("shows an amber, inline-resolvable alert instead of a red overdue alert", () => {
      const db = createTestDb()
      seedSchoolDose(db)

      const [status] = evaluateDashboardPersonStatus(db, [person()], {
        now: new Date("2025-01-15T12:20:00.000Z"),
        calCtx: UTC_CALCTX,
      })

      expect(status.status).toBe("amber")
      expect(status.issues).toEqual([expect.objectContaining({ kind: "dose_expectation_pending" })])
      expect(status.alerts).toEqual([
        expect.objectContaining({
          severity: "amber",
          action_url: null,
          short: "Methylphenidate · 12:00 away from home?",
          resolve: { expectationId: 1, ymd: "2025-01-15" },
        }),
      ])
    })

    it("goes back to all clear once the parent confirms the dose was missed", () => {
      const db = createTestDb()
      seedSchoolDose(db)
      db.prepare(
        "INSERT INTO dose_expectation_outcomes (dose_expectation_id, local_ymd, status) VALUES (1, '2025-01-15', 'confirmed_missed')",
      ).run()

      const [status] = evaluateDashboardPersonStatus(db, [person()], {
        now: new Date("2025-01-15T12:20:00.000Z"),
        calCtx: UTC_CALCTX,
      })

      expect(status.status).toBe("green")
      expect(status.alerts).toEqual([])
    })
  })

  describe("open symptoms", () => {
    const NOW = new Date("2025-01-15T12:00:00.000Z")
    const addSymptom = (db: Database.Database, start: string, label = "Headache") =>
      db.prepare("INSERT INTO symptom_events (person_id, label, start_date) VALUES (1, ?, ?)").run(label, start)

    it("shows a Notice, not amber and not green, when the only issue is an Open symptom prompt", () => {
      const db = createTestDb()
      db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
      addSymptom(db, "2025-01-12T00:00:00.000Z")

      const [status] = evaluateDashboardPersonStatus(db, [person()], { now: NOW, calCtx: UTC_CALCTX })

      expect(status.status).toBe("notice")
      expect(status.alerts).toEqual([
        expect.objectContaining({
          severity: "notice",
          type: "symptom",
          action_url: null,
          short: "Headache · open since 12 Jan",
          detail: { name: "Headache", sub: "Open since 12 Jan: still ongoing?" },
          resolveSymptom: { symptomId: 1, startYmd: "2025-01-12" },
        }),
      ])
    })

    it("does not prompt on the start day, and stops once the symptom is confirmed today", () => {
      const db = createTestDb()
      db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
      addSymptom(db, "2025-01-15T00:00:00.000Z")
      expect(evaluateDashboardPersonStatus(db, [person()], { now: NOW, calCtx: UTC_CALCTX })[0]!.status).toBe("green")

      addSymptom(db, "2025-01-10T00:00:00.000Z", "Cough")
      db.prepare("UPDATE symptom_events SET ongoing_confirmed_on = '2025-01-15' WHERE label = 'Cough'").run()
      expect(evaluateDashboardPersonStatus(db, [person()], { now: NOW, calCtx: UTC_CALCTX })[0]!.alerts).toEqual([])
    })

    it("is outranked by an amber hydration alert, which still escalates a Notice-only Person", () => {
      const db = createTestDb()
      db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
      db.prepare("INSERT INTO observation_goals (person_id, observation_type, target_value, unit) VALUES (1, 'Hydration', 2000, 'mL')").run()
      addSymptom(db, "2025-01-12T00:00:00.000Z")

      const [status] = evaluateDashboardPersonStatus(db, [person()], { now: NOW, calCtx: UTC_CALCTX })

      expect(status.status).toBe("amber")
      expect(status.alerts).toHaveLength(2)
    })

    it("sorts a Notice after red and amber issues", () => {
      const db = createTestDb()
      db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
      db.prepare("INSERT INTO medications (id, name) VALUES (1, 'Paracetamol')").run()
      db.prepare(
        `INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_frequency, schedule_tz)
         VALUES (1, 1, 1, ?, ?, 'UTC')`,
      ).run(JSON.stringify(["10:00"]), JSON.stringify({ kind: "daily" }))
      addSymptom(db, "2025-01-12T00:00:00.000Z")

      // Inside the 10:00 slot's overdue grace window, so the dose is a red issue.
      const [status] = evaluateDashboardPersonStatus(db, [person()], { now: new Date("2025-01-15T10:45:00.000Z"), calCtx: UTC_CALCTX })

      expect(status.status).toBe("red")
      expect(status.alerts.map(a => a.severity)).toEqual(["red", "notice"])
    })
  })
})
