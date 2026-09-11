import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/auth/auth-helpers", () => ({
  requireAuth: vi.fn(async () => ({
    session: { user: { email: "writer@test", id: "local:1" } },
    groups: ["local:write"],
  })),
  authorisePersonAccess: vi.fn((_db, _ctx, personId: number) => ({
    id: personId,
    name: "Pat",
    account_uid: null,
    is_active: 1,
  })),
}))

let testDb: Database.Database

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>()
  return {
    ...actual,
    getDb: () => testDb,
  }
})

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      date_of_birth TEXT,
      account_uid TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE medications (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE medication_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      medication_id INTEGER NOT NULL,
      recorded_at TEXT NOT NULL
    );
    CREATE TABLE medication_frequency_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      observation_type TEXT NOT NULL,
      value REAL,
      unit TEXT,
      recorded_at TEXT NOT NULL
    );
    CREATE TABLE prn_push_requests (
      medication_record_id INTEGER PRIMARY KEY,
      remind_after_hours REAL
    );
    CREATE TABLE app_settings (
      key TEXT NOT NULL PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  return db
}

function seedRecordWithWeightBand(db: Database.Database, weightKg: number): number {
  db.prepare(
    "INSERT INTO people (id, name, date_of_birth) VALUES (1, 'Pat', '2015-01-01')",
  ).run()
  db.prepare("INSERT INTO medications (id, name) VALUES (1, 'PRN Med')").run()
  db.prepare(
    `INSERT INTO medication_frequency_rules
       (medication_id, min_hours_between, min_weight_kg, max_weight_kg)
     VALUES
       (1, 8, 10, 30),
       (1, 4, 40, 80)`,
  ).run()
  db.prepare(
    `INSERT INTO observations (person_id, observation_type, value, unit, recorded_at)
     VALUES (1, 'Weight', ?, 'kg', datetime('now'))`,
  ).run(weightKg)
  const result = db
    .prepare(
      `INSERT INTO medication_records (person_id, medication_id, recorded_at)
       VALUES (1, 1, datetime('now'))`,
    )
    .run()
  return Number(result.lastInsertRowid)
}

describe("POST /api/push/prn-reminder", () => {
  beforeEach(() => {
    testDb = createTestDb()
    vi.resetModules()
  })

  afterEach(() => {
    testDb?.close()
  })

  it("succeeds using latest weight observation (no people.weight_kg column)", async () => {
    const recordId = seedRecordWithWeightBand(testDb, 20)
    const { POST } = await import("@/app/api/push/prn-reminder/route")
    const req = new NextRequest("http://localhost/api/push/prn-reminder", {
      method: "POST",
      body: JSON.stringify({ medication_record_id: recordId }),
      headers: { "content-type": "application/json" },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const row = testDb
      .prepare("SELECT remind_after_hours FROM prn_push_requests WHERE medication_record_id = ?")
      .get(recordId) as { remind_after_hours: number | null }
    expect(row).toBeDefined()
    expect(row.remind_after_hours).toBeNull()
  })

  it("applies weight-banded min interval from the observation", async () => {
    const recordId = seedRecordWithWeightBand(testDb, 20)
    const { POST } = await import("@/app/api/push/prn-reminder/route")

    const tooSoon = new NextRequest("http://localhost/api/push/prn-reminder", {
      method: "POST",
      body: JSON.stringify({ medication_record_id: recordId, remind_after_hours: 5 }),
      headers: { "content-type": "application/json" },
    })
    const denied = await POST(tooSoon)
    expect(denied.status).toBe(400)
    const deniedBody = await denied.json()
    expect(deniedBody.error).toMatch(/8 hours/)

    const okReq = new NextRequest("http://localhost/api/push/prn-reminder", {
      method: "POST",
      body: JSON.stringify({ medication_record_id: recordId, remind_after_hours: 8 }),
      headers: { "content-type": "application/json" },
    })
    const ok = await POST(okReq)
    expect(ok.status).toBe(200)

    const row = testDb
      .prepare("SELECT remind_after_hours FROM prn_push_requests WHERE medication_record_id = ?")
      .get(recordId) as { remind_after_hours: number | null }
    expect(row.remind_after_hours).toBe(8)
  })
})
