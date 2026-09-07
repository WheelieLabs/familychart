import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/auth/auth-helpers", () => ({
  requireAuth: vi.fn(async () => ({
    session: { user: { email: "u@test", id: "local:1", groups: ["local:write"] } },
    groups: ["local:write"],
  })),
  authorisePersonAccess: vi.fn(() => ({ id: 1, name: "Pat", account_uid: null })),
}))

vi.mock("@/lib/demo/demo-profanity-guard", () => ({
  rejectDemoProfanity: vi.fn(async () => null),
}))

let testDb: Database.Database

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
}))

vi.mock("@/lib/audit-log", () => ({
  auditLog: vi.fn(),
}))

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      account_uid TEXT
    );
    INSERT INTO people (id, name) VALUES (1, 'Pat');
    CREATE TABLE observation_type_config (
      id INTEGER PRIMARY KEY,
      observation_type TEXT NOT NULL,
      is_static INTEGER NOT NULL DEFAULT 0,
      chart_type TEXT,
      typical_unit TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      max_age_years INTEGER,
      stale_after_hours INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO observation_type_config (observation_type, typical_unit, is_active)
    VALUES ('Weight', 'kg', 1);
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      observation_type TEXT NOT NULL,
      value REAL NOT NULL,
      unit TEXT NOT NULL,
      recorded_at DATETIME NOT NULL,
      comments TEXT,
      created_by TEXT,
      session_id TEXT,
      value_label TEXT
    );
  `)
  return db
}

function postRequest(recordedAt: string): NextRequest {
  return new NextRequest("http://localhost/api/observations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      person_id: 1,
      observation_type: "Weight",
      value: 12.5,
      unit: "kg",
      recorded_at: recordedAt,
    }),
  })
}

describe("observation write recorded_at bounds", () => {
  beforeEach(() => {
    testDb = createTestDb()
    vi.resetModules()
  })

  afterEach(() => {
    testDb.close()
  })

  it("rejects a future recorded_at on POST with 400", async () => {
    const { POST } = await import("@/app/api/observations/route")
    const future = new Date(Date.now() + 60 * 60_000).toISOString()
    const res = await POST(postRequest(future))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: "recorded_at cannot be in the future" })
    expect(testDb.prepare("SELECT COUNT(*) AS n FROM observations").get()).toEqual({ n: 0 })
  })

  it("rejects an implausibly old recorded_at on POST with 400", async () => {
    const { POST } = await import("@/app/api/observations/route")
    const res = await POST(postRequest("1850-01-01T00:00:00Z"))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: "recorded_at is implausibly old" })
    expect(testDb.prepare("SELECT COUNT(*) AS n FROM observations").get()).toEqual({ n: 0 })
  })

  it("accepts an in-range historical recorded_at on POST", async () => {
    const { POST } = await import("@/app/api/observations/route")
    const res = await POST(postRequest("2020-01-01T08:00:00Z"))
    expect(res.status).toBe(201)
    const row = testDb.prepare("SELECT recorded_at FROM observations").get() as { recorded_at: string }
    expect(row.recorded_at).toBe("2020-01-01T08:00:00Z")
  })

  it("rejects PATCH that only changes recorded_at to a far-future stamp", async () => {
    testDb.prepare(
      `INSERT INTO observations (person_id, observation_type, value, unit, recorded_at)
       VALUES (1, 'Weight', 12.5, 'kg', '2020-01-01T08:00:00Z')`,
    ).run()
    const { PATCH } = await import("@/app/api/observations/route")
    const res = await PATCH(
      new NextRequest("http://localhost/api/observations?id=1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recorded_at: "2099-01-01T00:00:00Z" }),
      }),
    )
    expect(res.status).toBe(400)
    const row = testDb.prepare("SELECT recorded_at FROM observations WHERE id = 1").get() as { recorded_at: string }
    expect(row.recorded_at).toBe("2020-01-01T08:00:00Z")
  })

  it("rejects a future recorded_at on PUT with 400", async () => {
    testDb.prepare(
      `INSERT INTO observations (person_id, observation_type, value, unit, recorded_at)
       VALUES (1, 'Weight', 12.5, 'kg', '2020-01-01T08:00:00Z')`,
    ).run()
    const { PUT } = await import("@/app/api/observations/[id]/route")
    const future = new Date(Date.now() + 60 * 60_000).toISOString()
    const res = await PUT(
      new NextRequest("http://localhost/api/observations/1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recorded_at: future,
          value: 12.5,
          unit: "kg",
        }),
      }),
      { params: Promise.resolve({ id: "1" }) },
    )
    expect(res.status).toBe(400)
    const row = testDb.prepare("SELECT recorded_at FROM observations WHERE id = 1").get() as { recorded_at: string }
    expect(row.recorded_at).toBe("2020-01-01T08:00:00Z")
  })
})
