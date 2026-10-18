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

// This test only exercises administered_by persistence, not PRN supersession or push
// notifications — stub both out rather than faking their full table dependencies
// (medication_group_members, prn_push_requests, push_subscriptions, ...).
vi.mock("@/lib/prn/prn-push-supersede", () => ({
  clearSupersededPrnPushRequests: () => 0,
}))
vi.mock("@/lib/push", () => ({
  sendMedicationAcknowledgementPushes: async () => {},
}))

function createDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE app_settings (
      key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (key)
    );
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE medications (
      id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 1,
      dosage_unit TEXT DEFAULT 'Tabs', min_age_years INTEGER, max_age_years INTEGER
    );
    CREATE TABLE person_medications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      medication_id INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1,
      schedule_times TEXT, schedule_frequency TEXT, schedule_start_date TEXT,
      schedule_end_date TEXT, schedule_tz TEXT,
      schedule_created_at_ms INTEGER
    );
    CREATE TABLE medication_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      medication_id INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      dosage REAL,
      dosage_unit TEXT,
      comments TEXT,
      administered_by TEXT,
      created_by TEXT
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT, action TEXT, entity_type TEXT, entity_id INTEGER, details TEXT
    );
    INSERT INTO people (id, name) VALUES (1, 'Test Person');
    INSERT INTO medications (id, name) VALUES (1, 'Amoxicillin');
  `)
  return db
}

vi.mock("@/lib/db", () => ({ getDb: () => testDb }))

let testDb: Database.Database

function postRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/records", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}

function patchRequest(id: number, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost/api/records?id=${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}

describe("medication_records administered_by", () => {
  beforeEach(() => {
    vi.resetModules()
    authorisePersonAccess.mockReset()
    authorisePersonAccess.mockReturnValue({ id: 1, name: "Test Person", account_uid: null, is_active: 1 })
    testDb = createDb()
  })

  afterEach(() => {
    testDb.close()
    vi.clearAllMocks()
  })

  it("defaults to \"me\" when not supplied on create", async () => {
    const { POST } = await import("@/app/api/records/route")
    const res = await POST(postRequest({
      person_id: 1, medication_id: 1, recorded_at: "2026-01-01T08:00:00.000Z",
    }))
    expect(res.status).toBe(201)
    const row = testDb.prepare("SELECT administered_by FROM medication_records").get() as {
      administered_by: string
    }
    expect(row.administered_by).toBe("me")
  })

  it("persists a supplied value through create and returns it from GET", async () => {
    const { POST, GET } = await import("@/app/api/records/route")
    await POST(postRequest({
      person_id: 1, medication_id: 1, recorded_at: "2026-01-01T08:00:00.000Z",
      administered_by: "away_from_home",
    }))

    const getRes = await GET(new NextRequest("http://localhost/api/records?person_id=1"))
    const rows = (await getRes.json()) as { administered_by: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.administered_by).toBe("away_from_home")
  })

  it("rejects an unrecognised administered_by value on create", async () => {
    const { POST } = await import("@/app/api/records/route")
    const res = await POST(postRequest({
      person_id: 1, medication_id: 1, recorded_at: "2026-01-01T08:00:00.000Z",
      administered_by: "the school nurse",
    }))
    expect(res.status).toBe(400)
  })

  it("updates administered_by via PATCH", async () => {
    const { POST, PATCH } = await import("@/app/api/records/route")
    const createRes = await POST(postRequest({
      person_id: 1, medication_id: 1, recorded_at: "2026-01-01T08:00:00.000Z",
    }))
    const { id } = (await createRes.json()) as { id: number }

    const patchRes = await PATCH(patchRequest(id, {
      recorded_at: "2026-01-01T08:00:00.000Z", administered_by: "another_caregiver",
    }))
    expect(patchRes.status).toBe(200)
    const row = testDb.prepare("SELECT administered_by FROM medication_records WHERE id = ?").get(id) as {
      administered_by: string
    }
    expect(row.administered_by).toBe("another_caregiver")
  })
})
