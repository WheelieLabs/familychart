// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const authorisePersonAccess = vi.fn()

vi.mock("@/lib/auth/auth-helpers", () => ({
  requireAuth: vi.fn(async () => ({
    session: { user: { email: "demo@test", id: "local:1", groups: ["local:write"] } },
    groups: ["local:write"],
  })),
  authorisePersonAccess: (...args: unknown[]) =>
    authorisePersonAccess(...(args as Parameters<typeof authorisePersonAccess>)),
}))

function createDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE app_settings (
      key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (key)
    );
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE medications (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE person_medications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      medication_id INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1,
      schedule_times TEXT,
      schedule_frequency TEXT,
      schedule_start_date TEXT,
      schedule_end_date TEXT,
      schedule_tz TEXT,
      schedule_created_at_ms INTEGER
    );
    CREATE TABLE medication_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      medication_id INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      dosage REAL,
      dosage_unit TEXT,
      comments TEXT
    );
    CREATE TABLE slot_outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_medication_id INTEGER NOT NULL,
      local_ymd TEXT NOT NULL,
      slot_hhmm TEXT NOT NULL,
      result TEXT NOT NULL,
      offset_minutes INTEGER,
      missed_cause TEXT,
      medication_record_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(person_medication_id, local_ymd, slot_hhmm)
    );
    INSERT INTO people (id, name) VALUES (1, 'Test Person');
    INSERT INTO medications (id, name) VALUES (1, 'Med A'), (2, 'Med B');
    INSERT INTO person_medications
      (person_id, medication_id, is_active, schedule_times, schedule_frequency, schedule_start_date)
      VALUES (1, 1, 1, '["08:00"]', '{"kind":"daily"}', '2024-01-01');
  `)
  return db
}

vi.mock("@/lib/db", () => ({ getDb: () => testDb }))

let testDb: Database.Database

function makeRequest(query: string, headers: Record<string, string> = { "x-fc-tz-offset": "0" }): NextRequest {
  return new NextRequest(`http://localhost/api/records?${query}`, { headers })
}

describe("GET /api/records — dose timing from stored slot outcomes", () => {
  beforeEach(() => {
    vi.resetModules()
    authorisePersonAccess.mockReset()
    testDb = createDb()
  })

  afterEach(() => {
    testDb.close()
    vi.clearAllMocks()
  })

  it("labels each dose from its stored outcome, leaving unattached and unscheduled doses unlabelled", async () => {
    authorisePersonAccess.mockReturnValue({ id: 1, name: "Test Person", account_uid: null, is_active: 1 })
    testDb.prepare(
      `INSERT INTO medication_records (id, person_id, medication_id, recorded_at) VALUES
        (1, 1, 1, '2024-06-01T08:05:00.000Z'),
        (2, 1, 1, '2024-06-01T08:45:00.000Z'),
        (3, 1, 2, '2024-06-01T08:00:00.000Z'),
        (4, 1, 1, '2024-06-01T07:00:00.000Z')`,
    ).run()
    testDb.prepare(
      `INSERT INTO slot_outcomes (person_medication_id, local_ymd, slot_hhmm, result, offset_minutes, medication_record_id)
       VALUES (1, '2024-06-01', '08:00', 'on_time', 5, 1), (1, '2024-05-31', '20:00', 'late', 45, 2)`,
    ).run()

    const { GET } = await import("@/app/api/records/route")
    const res = await GET(makeRequest("person_id=1"))
    expect(res.status).toBe(200)
    const rows = (await res.json()) as Array<{ id: number; timing?: unknown; scheduled_time?: unknown; scheduled_late?: unknown }>
    const byId = (id: number) => rows.find(r => r.id === id)!

    expect(byId(1).timing).toEqual({ result: "on_time", offsetMinutes: 5, slotHhmm: "08:00" })
    expect(byId(2).timing).toEqual({ result: "late", offsetMinutes: 45, slotHhmm: "20:00" })
    expect(byId(3).timing).toBeUndefined()
    expect(byId(4).timing).toBeNull()
    expect(byId(1).scheduled_late).toBeUndefined()
  })

  it("skips enrichment entirely when no medication in the listing has a schedule", async () => {
    authorisePersonAccess.mockReturnValue({ id: 1, name: "Test Person", account_uid: null, is_active: 1 })
    testDb.prepare("UPDATE person_medications SET is_active = 0").run()
    testDb.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (1, 1, '2024-06-01T08:05:00.000Z')",
    ).run()

    const { GET } = await import("@/app/api/records/route")
    const res = await GET(makeRequest("person_id=1"))
    const rows = (await res.json()) as Array<{ timing?: unknown }>

    expect(rows).toHaveLength(1)
    expect(rows[0]!.timing).toBeUndefined()
  })
})
