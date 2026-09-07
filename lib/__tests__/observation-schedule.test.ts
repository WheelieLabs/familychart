import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  enrichExpectation,
  loadLastObservationAt,
  loadLastObservationAtByPersonType,
  loadLastObservationAtByType,
  isObservationAlertEligible,
} from "@/lib/observation/observation-schedule"
import type { PersonObservationExpectationRow } from "@/lib/observation/observation-recurrence"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      observation_type TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      value REAL,
      unit TEXT
    );
  `)
  return db
}

function baseRow(
  overrides: Partial<PersonObservationExpectationRow> = {},
): PersonObservationExpectationRow {
  return {
    id: 1,
    person_id: 1,
    observation_type: "Weight",
    cadence: "daily",
    interval_days: null,
    recurrence_day_of_month: null,
    recurrence_month: null,
    recurrence_day: null,
    recurrence_use_birthday: 0,
    enabled: 1,
    due_time_hhmm: "09:00",
    tz: "UTC",
    ...overrides,
  }
}

describe("observation-schedule last-at loaders", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    db.prepare(
      `INSERT INTO observations (person_id, observation_type, recorded_at) VALUES (?, ?, ?)`,
    ).run(1, "Weight", "2026-06-01T00:00:00.000Z")
    db.prepare(
      `INSERT INTO observations (person_id, observation_type, recorded_at) VALUES (?, ?, ?)`,
    ).run(1, "Weight", "2026-06-10T00:00:00.000Z")
    db.prepare(
      `INSERT INTO observations (person_id, observation_type, recorded_at) VALUES (?, ?, ?)`,
    ).run(1, "Height", "2026-06-05T00:00:00.000Z")
    db.prepare(
      `INSERT INTO observations (person_id, observation_type, recorded_at) VALUES (?, ?, ?)`,
    ).run(2, "Weight", "2026-06-08T00:00:00.000Z")
  })

  afterEach(() => {
    db?.close()
  })

  it("loads MAX recorded_at per person+type", () => {
    const map = loadLastObservationAtByPersonType(db, [1, 2])
    expect(map.get("1:Weight")).toBe("2026-06-10T00:00:00.000Z")
    expect(map.get("1:Height")).toBe("2026-06-05T00:00:00.000Z")
    expect(map.get("2:Weight")).toBe("2026-06-08T00:00:00.000Z")
  })

  it("loads MAX recorded_at by type for one person", () => {
    const map = loadLastObservationAtByType(db, 1)
    expect(map.get("Weight")).toBe("2026-06-10T00:00:00.000Z")
    expect(map.get("Height")).toBe("2026-06-05T00:00:00.000Z")
  })

  it("loads single last-at", () => {
    expect(loadLastObservationAt(db, 1, "Weight")).toBe("2026-06-10T00:00:00.000Z")
    expect(loadLastObservationAt(db, 1, "Blood Pressure")).toBeNull()
  })
})

// ── isObservationAlertEligible (dashboard↔cron parity) ─────────────────────

describe("isObservationAlertEligible", () => {
  // Australia/Brisbane: fixed UTC+10, no DST — avoids relying on a "UTC" IANA alias, which
  // Intl.supportedValuesOf("timeZone") doesn't provide on all Node/ICU builds.
  const TZ = "Australia/Brisbane"
  // 2026-06-11T00:00:00Z = 2026-06-11 10:00 local Brisbane.
  const now = new Date("2026-06-11T00:00:00.000Z")
  // Daily cadence, due 09:00 local, never recorded — overdue as of 10:00 local same day.
  const overdueRow = baseRow({ cadence: "daily", due_time_hhmm: "09:00", tz: TZ })

  it("is eligible when overdue, catalogued, and no age gate", () => {
    const cfg = { max_age_years: null }
    expect(isObservationAlertEligible(overdueRow, null, null, now, TZ, cfg)).toBe(true)
  })

  it("is not eligible when the observation type has no catalogue entry", () => {
    expect(isObservationAlertEligible(overdueRow, null, null, now, TZ, undefined)).toBe(false)
  })

  it("is not eligible when the person has aged out (max_age_years)", () => {
    const cfg = { max_age_years: 5 }
    const dobTenYearsAgo = "2016-06-11"
    expect(isObservationAlertEligible(overdueRow, null, dobTenYearsAgo, now, TZ, cfg)).toBe(false)
  })

  it("is eligible when the person is within the age gate", () => {
    const cfg = { max_age_years: 5 }
    const dobTwoYearsAgo = "2024-06-11"
    expect(isObservationAlertEligible(overdueRow, null, dobTwoYearsAgo, now, TZ, cfg)).toBe(true)
  })

  it("is not eligible when not overdue, regardless of catalogue/age", () => {
    const cfg = { max_age_years: null }
    // 2026-06-10T23:00:00Z = 2026-06-11 09:00 local — same local day as `now`.
    const recentlyRecorded = "2026-06-10T23:00:00.000Z"
    expect(isObservationAlertEligible(overdueRow, recentlyRecorded, null, now, TZ, cfg)).toBe(false)
  })

  it("ignores max_age_years when the person has no date of birth", () => {
    const cfg = { max_age_years: 5 }
    expect(isObservationAlertEligible(overdueRow, null, null, now, TZ, cfg)).toBe(true)
  })
})

describe("enrichExpectation", () => {
  it("attaches last_recorded_at and next_due_at", () => {
    const sched = {
      now: new Date("2026-06-11T10:00:00.000Z"),
      tzOffsetMinutes: 0,
      localTodayYmd: "2026-06-11",
    }
    const enriched = enrichExpectation(
      baseRow(),
      "2026-06-10T00:00:00.000Z",
      null,
      sched,
      "UTC",
    )
    expect(enriched.last_recorded_at).toBe("2026-06-10T00:00:00.000Z")
    expect(enriched.next_due_at).toBeTruthy()
  })
})
