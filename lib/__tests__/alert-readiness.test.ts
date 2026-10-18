// SPDX-License-Identifier: AGPL-3.0-only

import { DOSE_EXPECTATION_TABLES_SQL } from "@/lib/__tests__/dose-expectation-fixtures"
import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, describe, expect, it } from "vitest"
import { evaluateAlertReadiness } from "@/lib/alert-readiness"
import type { CalendarContext } from "@/lib/calendar-context"
import type { Person } from "@/lib/domain-types"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      full_name TEXT,
      photo_url TEXT,
      color TEXT NOT NULL DEFAULT '#000',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      account_uid TEXT,
      date_of_birth TEXT
    );
    CREATE TABLE medications (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      default_dosage REAL,
      dosage_unit TEXT NOT NULL DEFAULT 'Tabs',
      notes TEXT,
      min_age_years INTEGER,
      max_age_years INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE medication_groups (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE medication_group_members (
      medication_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL
    );
    CREATE TABLE person_medications (
      id INTEGER PRIMARY KEY,
      person_id INTEGER NOT NULL,
      medication_id INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      schedule_times TEXT,
      schedule_frequency TEXT,
      schedule_start_date TEXT,
      schedule_end_date TEXT,
      schedule_slots TEXT,
      schedule_tz TEXT,
      schedule_created_at_ms INTEGER
    );
    CREATE TABLE medication_records (
      id INTEGER PRIMARY KEY,
      person_id INTEGER NOT NULL,
      medication_id INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      dosage REAL,
      dosage_unit TEXT,
      comments TEXT,
      created_by TEXT
    );
    CREATE TABLE medication_frequency_rules (
      id INTEGER PRIMARY KEY,
      medication_id INTEGER,
      min_hours_between REAL NOT NULL DEFAULT 0,
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
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY,
      person_id INTEGER NOT NULL,
      observation_type TEXT NOT NULL,
      value REAL NOT NULL,
      unit TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    );
    CREATE TABLE person_observation_expectations (
      id INTEGER PRIMARY KEY,
      person_id INTEGER NOT NULL,
      observation_type TEXT NOT NULL,
      cadence TEXT NOT NULL,
      interval_days REAL,
      recurrence_day_of_month INTEGER,
      recurrence_month INTEGER,
      recurrence_day INTEGER,
      recurrence_use_birthday INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      due_time_hhmm TEXT NOT NULL DEFAULT '00:00',
      tz TEXT
    );
    CREATE TABLE observation_type_config (
      id INTEGER PRIMARY KEY,
      observation_type TEXT NOT NULL UNIQUE,
      is_static INTEGER NOT NULL DEFAULT 0,
      chart_type TEXT NOT NULL DEFAULT 'line',
      typical_unit TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      max_age_years REAL,
      stale_after_hours REAL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE prn_push_requests (
      medication_record_id INTEGER PRIMARY KEY,
      requested_at TEXT,
      remind_after_hours REAL
    );
    CREATE TABLE app_settings (
      key TEXT NOT NULL PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  db.exec(DOSE_EXPECTATION_TABLES_SQL)
  return db
}

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: 1,
    name: "Alice",
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

describe("evaluateAlertReadiness", () => {
  let db: Database.Database

  afterEach(() => {
    db?.close()
  })

  it("returns empty facts when there are no people", () => {
    db = createTestDb()
    const facts = evaluateAlertReadiness(db, [], Date.parse("2025-01-15T10:00:00.000Z"), UTC_CALCTX)
    expect(facts).toEqual({
      scheduledSlots: [],
      prnBlockedSlots: [],
      prnFlags: [],
      overdueObservations: [],
      pendingDoseExpectations: [],
    })
  })

  it("returns a due Scheduled slot fact with person and medication labels", () => {
    db = createTestDb()
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    db.prepare("INSERT INTO medications (id, name, default_dosage) VALUES (1, 'Paracetamol', 1)").run()
    db.prepare(
      `INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_frequency, schedule_tz)
       VALUES (1, 1, 1, ?, ?, 'UTC')`,
    ).run(JSON.stringify(["10:00"]), JSON.stringify({ kind: "daily" }))

    const nowMs = Date.parse("2025-01-15T10:00:00.000Z")
    const facts = evaluateAlertReadiness(db, [person()], nowMs, UTC_CALCTX)

    expect(facts.scheduledSlots).toEqual([
      expect.objectContaining({
        personId: 1,
        personName: "Alice",
        personMedicationId: 1,
        medicationId: 1,
        medicationName: "Paracetamol",
        ymd: "2025-01-15",
        hhmm: "10:00",
        status: "due",
      }),
    ])
    expect(facts.prnBlockedSlots).toEqual([])
  })

  it("applies the request fallback calendar when the row has no IANA timezone", () => {
    db = createTestDb()
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    db.prepare("INSERT INTO medications (id, name) VALUES (1, 'Paracetamol')").run()
    db.prepare(
      `INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_frequency)
       VALUES (1, 1, 1, ?, ?)`,
    ).run(JSON.stringify(["10:00"]), JSON.stringify({ kind: "daily" }))

    const nowMs = Date.parse("2025-01-15T10:00:00.000Z")
    const facts = evaluateAlertReadiness(db, [person()], nowMs, UTC_CALCTX)

    expect(facts.scheduledSlots).toEqual([
      expect.objectContaining({ ymd: "2025-01-15", hhmm: "10:00", status: "due" }),
    ])
  })

  it("uses the instance timezone when no fallback calendar is passed", () => {
    const prevTz = process.env.FC_DEFAULT_TIMEZONE
    process.env.FC_DEFAULT_TIMEZONE = "Europe/London"
    db = createTestDb()
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    db.prepare("INSERT INTO medications (id, name) VALUES (1, 'Paracetamol')").run()
    db.prepare(
      `INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_frequency)
       VALUES (1, 1, 1, ?, ?)`,
    ).run(JSON.stringify(["10:00"]), JSON.stringify({ kind: "daily" }))

    try {
      const nowMs = Date.parse("2025-01-15T10:00:00.000Z")
      const facts = evaluateAlertReadiness(db, [person()], nowMs)
      expect(facts.scheduledSlots).toEqual([
        expect.objectContaining({ ymd: "2025-01-15", hhmm: "10:00", status: "due" }),
      ])
    } finally {
      if (prevTz === undefined) delete process.env.FC_DEFAULT_TIMEZONE
      else process.env.FC_DEFAULT_TIMEZONE = prevTz
    }
  })

  function seedScheduledMed(opts: {
    rule: { maxQty: number; countDoses: 0 | 1; dosage?: number | null }
    scheduled?: boolean
    endDate?: string | null
    doses: { dosage?: number; unit?: string }[]
  }) {
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    db.prepare("INSERT INTO medications (id, name) VALUES (1, 'Paracetamol')").run()
    if (opts.scheduled === false) {
      db.prepare("INSERT INTO person_medications (id, person_id, medication_id) VALUES (1, 1, 1)").run()
    } else {
      db.prepare(
        `INSERT INTO person_medications
           (id, person_id, medication_id, schedule_times, schedule_frequency, schedule_start_date, schedule_end_date, schedule_tz)
         VALUES (1, 1, 1, ?, ?, '2025-01-01', ?, 'UTC')`,
      ).run(JSON.stringify(["12:00"]), JSON.stringify({ kind: "daily" }), opts.endDate ?? null)
    }
    db.prepare(
      `INSERT INTO medication_frequency_rules
         (id, medication_id, min_hours_between, max_quantity_per_24h, max_per_24h_count_doses, dosage)
       VALUES (1, 1, 0, ?, ?, ?)`,
    ).run(opts.rule.maxQty, opts.rule.countDoses, opts.rule.dosage ?? null)
    opts.doses.forEach((d, i) => {
      db.prepare(
        `INSERT INTO medication_records (person_id, medication_id, recorded_at, dosage, dosage_unit)
         VALUES (1, 1, datetime('now', ?), ?, ?)`,
      ).run(`-${i + 1} hours`, d.dosage ?? null, d.unit ?? null)
    })
  }

  const SLOT_NOW = Date.parse("2025-01-15T12:00:00.000Z")

  it("moves a due Scheduled slot to prnBlockedSlots when a scheduled medication allowing two doses a day is at cap", () => {
    db = createTestDb()
    seedScheduledMed({ rule: { maxQty: 2, countDoses: 1 }, doses: [{}, {}] })

    const facts = evaluateAlertReadiness(db, [person()], SLOT_NOW, UTC_CALCTX)

    expect(facts.scheduledSlots).toEqual([])
    expect(facts.prnBlockedSlots).toEqual([
      expect.objectContaining({ personId: 1, medicationId: 1, medicationName: "Paracetamol", status: "due" }),
    ])
    expect(facts.prnFlags).toEqual([
      expect.objectContaining({ personId: 1, medicationId: 1, atCap: true, canDose: false }),
    ])
  })

  it("expects the cap for a scheduled once-a-day medication: no at-cap flag and its slot stays a Scheduled slot", () => {
    db = createTestDb()
    seedScheduledMed({ rule: { maxQty: 1, countDoses: 1 }, doses: [{}] })

    const facts = evaluateAlertReadiness(db, [person()], SLOT_NOW, UTC_CALCTX)

    expect(facts.prnFlags).toEqual([])
    expect(facts.prnBlockedSlots).toEqual([])
    expect(facts.scheduledSlots).toEqual([expect.objectContaining({ medicationId: 1, status: "due" })])
  })

  it("treats a quantity maximum of exactly one dose unit as once a day", () => {
    db = createTestDb()
    seedScheduledMed({
      rule: { maxQty: 1, countDoses: 0, dosage: 1 },
      doses: [{ dosage: 1, unit: "Tabs" }],
    })

    const facts = evaluateAlertReadiness(db, [person()], SLOT_NOW, UTC_CALCTX)

    expect(facts.prnFlags).toEqual([])
    expect(facts.prnBlockedSlots).toEqual([])
  })

  it("keeps the cap for a quantity maximum that allows two dose units", () => {
    db = createTestDb()
    seedScheduledMed({
      rule: { maxQty: 2, countDoses: 0, dosage: 1 },
      doses: [{ dosage: 1, unit: "Tabs" }, { dosage: 1, unit: "Tabs" }],
    })

    const facts = evaluateAlertReadiness(db, [person()], SLOT_NOW, UTC_CALCTX)

    expect(facts.prnFlags).toEqual([expect.objectContaining({ atCap: true })])
  })

  it("keeps the cap for an unscheduled once-a-day medication", () => {
    db = createTestDb()
    seedScheduledMed({ rule: { maxQty: 1, countDoses: 1 }, scheduled: false, doses: [{}] })

    const facts = evaluateAlertReadiness(db, [person()], SLOT_NOW, UTC_CALCTX)

    expect(facts.prnFlags).toEqual([expect.objectContaining({ atCap: true })])
  })

  it("does not count an ended schedule as scheduled", () => {
    db = createTestDb()
    seedScheduledMed({ rule: { maxQty: 1, countDoses: 1 }, endDate: "2025-01-10", doses: [{}] })

    const facts = evaluateAlertReadiness(db, [person()], SLOT_NOW, UTC_CALCTX)

    expect(facts.prnFlags).toEqual([expect.objectContaining({ atCap: true })])
  })

  it("does not count an inactive assignment as scheduled", () => {
    db = createTestDb()
    seedScheduledMed({ rule: { maxQty: 1, countDoses: 1 }, doses: [{}] })
    db.prepare("UPDATE person_medications SET is_active = 0").run()
    // dosed within 14 days, so the medication is still evaluated for PRN state
    const facts = evaluateAlertReadiness(db, [person()], SLOT_NOW, UTC_CALCTX)

    expect(facts.prnFlags).toEqual([expect.objectContaining({ atCap: true })])
  })

  it("reports PRN at-cap flags with canDose meaning alert-clear only", () => {
    db = createTestDb()
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    db.prepare("INSERT INTO medications (id, name) VALUES (1, 'Ibuprofen')").run()
    db.prepare("INSERT INTO person_medications (id, person_id, medication_id) VALUES (1, 1, 1)").run()
    db.prepare(
      `INSERT INTO medication_frequency_rules
         (id, medication_id, min_hours_between, max_quantity_per_24h, max_per_24h_count_doses)
       VALUES (1, 1, 0, 2, 1)`,
    ).run()
    db.prepare(
      `INSERT INTO medication_records (id, person_id, medication_id, recorded_at)
       VALUES (1, 1, 1, datetime('now', '-3 hours')), (2, 1, 1, datetime('now', '-1 hour'))`,
    ).run()

    const nowMs = Date.parse("2025-01-15T12:00:00.000Z")
    const facts = evaluateAlertReadiness(db, [person()], nowMs, UTC_CALCTX)

    expect(facts.prnFlags).toEqual([
      expect.objectContaining({
        personId: 1,
        personName: "Alice",
        medicationId: 1,
        medicationName: "Ibuprofen",
        atCap: true,
        canDose: false,
      }),
    ])
  })

  it("omits Observation expectations that have no catalogue entry", () => {
    db = createTestDb()
    db.prepare("INSERT INTO people (id, name, date_of_birth) VALUES (1, 'Alice', '1990-01-01')").run()
    db.prepare(
      `INSERT INTO person_observation_expectations
         (id, person_id, observation_type, cadence, enabled, due_time_hhmm, tz)
       VALUES (1, 1, 'weight', 'daily', 1, '00:00', 'UTC')`,
    ).run()

    const nowMs = Date.parse("2025-06-15T12:00:00.000Z")
    const facts = evaluateAlertReadiness(db, [person({ date_of_birth: "1990-01-01" })], nowMs, UTC_CALCTX)

    expect(facts.overdueObservations).toEqual([])
  })

  it("omits Observation expectations the person has aged out of", () => {
    db = createTestDb()
    db.prepare("INSERT INTO people (id, name, date_of_birth) VALUES (1, 'Alice', '1990-01-01')").run()
    db.prepare(
      `INSERT INTO observation_type_config (id, observation_type, max_age_years)
       VALUES (1, 'height', 5)`,
    ).run()
    db.prepare(
      `INSERT INTO person_observation_expectations
         (id, person_id, observation_type, cadence, enabled, due_time_hhmm, tz)
       VALUES (1, 1, 'height', 'daily', 1, '00:00', 'UTC')`,
    ).run()

    const nowMs = Date.parse("2025-06-15T12:00:00.000Z")
    const facts = evaluateAlertReadiness(db, [person({ date_of_birth: "1990-01-01" })], nowMs, UTC_CALCTX)

    expect(facts.overdueObservations).toEqual([])
  })

  it("emits a remind-after PRN fact when cooldown has elapsed and a push request is pending", () => {
    db = createTestDb()
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    db.prepare("INSERT INTO medications (id, name) VALUES (1, 'Ibuprofen')").run()
    db.prepare("INSERT INTO person_medications (id, person_id, medication_id) VALUES (1, 1, 1)").run()
    db.prepare(
      `INSERT INTO medication_frequency_rules (id, medication_id, min_hours_between)
       VALUES (1, 1, 4)`,
    ).run()
    db.prepare(
      `INSERT INTO medication_records (id, person_id, medication_id, recorded_at)
       VALUES (1, 1, 1, datetime('now', '-5 hours'))`,
    ).run()
    db.prepare(`INSERT INTO prn_push_requests (medication_record_id, remind_after_hours) VALUES (1, 4)`).run()

    const facts = evaluateAlertReadiness(db, [person()], Date.now(), UTC_CALCTX)

    expect(facts.prnFlags).toEqual([
      expect.objectContaining({
        medicationId: 1,
        remindAfterDue: true,
        canDose: true,
        remindAfterRecordIds: [1],
      }),
    ])
  })

  it("emits an overdue Observation fact when the type is catalogue-eligible", () => {
    db = createTestDb()
    db.prepare("INSERT INTO people (id, name, date_of_birth) VALUES (1, 'Alice', '1990-01-01')").run()
    db.prepare(
      `INSERT INTO observation_type_config (id, observation_type, max_age_years)
       VALUES (1, 'weight', NULL)`,
    ).run()
    db.prepare(
      `INSERT INTO person_observation_expectations
         (id, person_id, observation_type, cadence, enabled, due_time_hhmm, tz)
       VALUES (1, 1, 'weight', 'daily', 1, '00:00', 'Europe/London')`,
    ).run()

    const nowMs = Date.parse("2025-06-15T12:00:00.000Z")
    const facts = evaluateAlertReadiness(db, [person({ date_of_birth: "1990-01-01" })], nowMs, UTC_CALCTX)

    expect(facts.overdueObservations).toEqual([
      expect.objectContaining({
        personId: 1,
        personName: "Alice",
        expectationId: 1,
        observationType: "weight",
      }),
    ])
  })

  describe("dose expectations", () => {
    function seedSchoolDose() {
      db = createTestDb()
      db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
      db.prepare("INSERT INTO medications (id, name, default_dosage) VALUES (1, 'Methylphenidate', 1)").run()
      db.prepare(
        `INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_frequency, schedule_tz)
         VALUES (1, 1, 1, ?, ?, 'UTC')`,
      ).run(JSON.stringify(["08:00", "12:00"]), JSON.stringify({ kind: "daily" }))
      db.prepare(
        `INSERT INTO dose_expectations (id, person_medication_id, slot_hhmm, start_date, end_date)
         VALUES (1, 1, '12:00', '2025-01-13', '2025-03-28')`,
      ).run()
    }

    it("replaces the normal overdue alert for an external slot with a pending expectation", () => {
      seedSchoolDose()
      const nowMs = Date.parse("2025-01-15T12:20:00.000Z")
      const facts = evaluateAlertReadiness(db, [person()], nowMs, UTC_CALCTX)

      expect(facts.scheduledSlots.filter(s => s.hhmm === "12:00")).toEqual([])
      expect(facts.pendingDoseExpectations).toEqual([
        expect.objectContaining({
          personId: 1,
          personName: "Alice",
          personMedicationId: 1,
          medicationId: 1,
          medicationName: "Methylphenidate",
          expectationId: 1,
          ymd: "2025-01-15",
          hhmm: "12:00",
          scheduledDosage: 1,
        }),
      ])
    })

    it("leaves slots outside the expectation (the 08:00 home dose) alerting normally", () => {
      seedSchoolDose()
      const nowMs = Date.parse("2025-01-15T08:20:00.000Z")
      const facts = evaluateAlertReadiness(db, [person()], nowMs, UTC_CALCTX)
      expect(facts.scheduledSlots.filter(s => s.hhmm === "08:00")).toHaveLength(1)
      expect(facts.pendingDoseExpectations).toEqual([])
    })

    it("alerts normally on a day the expectation does not cover (out of term)", () => {
      seedSchoolDose()
      db.prepare("UPDATE dose_expectations SET end_date = '2025-01-10'").run()
      const nowMs = Date.parse("2025-01-15T12:20:00.000Z")
      const facts = evaluateAlertReadiness(db, [person()], nowMs, UTC_CALCTX)
      expect(facts.scheduledSlots.filter(s => s.hhmm === "12:00")).toHaveLength(1)
      expect(facts.pendingDoseExpectations).toEqual([])
    })

    it("does not prompt on a day the medication's own schedule doesn't run", () => {
      seedSchoolDose()
      // Weekly on Mondays only; 2025-01-15 is a Wednesday.
      db.prepare("UPDATE person_medications SET schedule_frequency = ?").run(JSON.stringify({ kind: "weekly", weekdays: [1] }))
      db.prepare("UPDATE person_medications SET schedule_start_date = '2025-01-01'").run()
      const facts = evaluateAlertReadiness(db, [person()], Date.parse("2025-01-15T12:20:00.000Z"), UTC_CALCTX)
      expect(facts.pendingDoseExpectations).toEqual([])
    })

    it("stops prompting when the slot time has been removed from the schedule", () => {
      seedSchoolDose()
      db.prepare("UPDATE person_medications SET schedule_times = ?").run(JSON.stringify(["08:00"]))
      const facts = evaluateAlertReadiness(db, [person()], Date.parse("2025-01-15T12:20:00.000Z"), UTC_CALCTX)
      expect(facts.pendingDoseExpectations).toEqual([])
    })

    it("stops prompting once the parent has confirmed the outcome", () => {
      seedSchoolDose()
      db.prepare(
        "INSERT INTO dose_expectation_outcomes (dose_expectation_id, local_ymd, status) VALUES (1, '2025-01-15', 'confirmed_missed')",
      ).run()
      const facts = evaluateAlertReadiness(db, [person()], Date.parse("2025-01-15T12:20:00.000Z"), UTC_CALCTX)
      expect(facts.pendingDoseExpectations).toEqual([])
      // A confirmed miss is history only: it must not resurrect the normal overdue alert either.
      expect(facts.scheduledSlots.filter(s => s.hhmm === "12:00")).toEqual([])
    })

    it("stops prompting once a dose is logged near the slot", () => {
      seedSchoolDose()
      db.prepare(
        "INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (1, 1, '2025-01-15T12:05:00.000Z')",
      ).run()
      const facts = evaluateAlertReadiness(db, [person()], Date.parse("2025-01-15T12:20:00.000Z"), UTC_CALCTX)
      expect(facts.pendingDoseExpectations).toEqual([])
    })
  })
})
