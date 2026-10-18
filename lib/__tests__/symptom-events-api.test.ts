import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const authorisePersonAccess = vi.fn()

vi.mock("@/lib/auth/auth-helpers", () => ({
  requireAuth: vi.fn(async () => ({
    session: { user: { email: "demo@test", id: "local:1", groups: ["local:write"] } },
    groups: ["local:write"],
  })),
  authorisePersonAccess: (...args: unknown[]) =>
    authorisePersonAccess(...(args as Parameters<typeof authorisePersonAccess>)),
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

// Local day fixed to 2026-10-03 at UTC+0 so the test does not depend on the machine's timezone.
vi.mock("@/lib/calendar-context", () => ({
  resolveCalendarContext: () => ({ ymd: "2026-10-03", offsetMinutes: 0, ianaTz: null }),
}))

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE symptom_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id    INTEGER NOT NULL,
      label        TEXT    NOT NULL,
      start_date   TEXT    NOT NULL,
      end_date     TEXT,
      severity     INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 5),
      is_resolved  INTEGER NOT NULL DEFAULT 0,
      resolved_at  DATETIME,
      notes        TEXT,
      ongoing_confirmed_on TEXT,
      created_by   TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
  return db
}

const PERSON = { id: 1, name: "Pat", account_uid: null, is_active: 1 }

function jsonRequest(url: string, method: string, body?: Record<string, unknown>) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

describe("/api/symptom-events", () => {
  beforeEach(() => {
    testDb = createTestDb()
    vi.resetModules()
    authorisePersonAccess.mockReset()
    authorisePersonAccess.mockReturnValue(PERSON)
  })

  afterEach(() => {
    testDb?.close()
  })

  it("returns the ACL denial without inserting a row", async () => {
    authorisePersonAccess.mockReturnValue(NextResponse.json({ error: "Not found" }, { status: 404 }))
    const { POST } = await import("@/app/api/symptom-events/route")
    const res = await POST(jsonRequest("http://localhost/api/symptom-events", "POST", {
      person_id: 99, label: "Cough", start_date: "2026-08-01T09:00:00.000Z", severity: 2,
    }))
    expect(res.status).toBe(404)
    expect(testDb.prepare("SELECT COUNT(*) as n FROM symptom_events").get()).toEqual({ n: 0 })
  })

  it("creates a symptom event", async () => {
    const { POST } = await import("@/app/api/symptom-events/route")
    const res = await POST(jsonRequest("http://localhost/api/symptom-events", "POST", {
      person_id: 1, label: "Runny nose", start_date: "2026-08-01T09:00:00.000Z", severity: 2,
    }))
    expect(res.status).toBe(201)
    const { id } = await res.json()

    const row = testDb.prepare("SELECT * FROM symptom_events WHERE id = ?").get(id) as Record<string, unknown>
    expect(row.label).toBe("Runny nose")
    expect(row.severity).toBe(2)
    expect(row.is_resolved).toBe(0)
    expect(row.resolved_at).toBeNull()
  })

  it("stores notes on create, replaces them on PATCH, and returns them from GET", async () => {
    const { POST, PATCH, GET } = await import("@/app/api/symptom-events/route")
    const createRes = await POST(jsonRequest("http://localhost/api/symptom-events", "POST", {
      person_id: 1, label: "Cough", start_date: "2026-08-01T09:00:00.000Z", severity: 2, notes: "Dry, worse at night",
    }))
    const { id } = await createRes.json()
    expect((testDb.prepare("SELECT notes FROM symptom_events WHERE id = ?").get(id) as { notes: string }).notes).toBe("Dry, worse at night")

    await PATCH(jsonRequest(`http://localhost/api/symptom-events?id=${id}`, "PATCH", {
      label: "Cough", start_date: "2026-08-01T09:00:00.000Z", severity: 2, notes: "",
    }))
    expect((testDb.prepare("SELECT notes FROM symptom_events WHERE id = ?").get(id) as { notes: string | null }).notes).toBeNull()

    await PATCH(jsonRequest(`http://localhost/api/symptom-events?id=${id}`, "PATCH", {
      label: "Cough", start_date: "2026-08-01T09:00:00.000Z", severity: 2, notes: "Settled",
    }))
    const listRes = await GET(new NextRequest("http://localhost/api/symptom-events?person_id=1"))
    expect((await listRes.json())[0].notes).toBe("Settled")
  })

  it("sets resolved_at when created already resolved", async () => {
    const { POST } = await import("@/app/api/symptom-events/route")
    const res = await POST(jsonRequest("http://localhost/api/symptom-events", "POST", {
      person_id: 1, label: "Cough", start_date: "2026-08-01T09:00:00.000Z", severity: 1, is_resolved: true,
    }))
    const { id } = await res.json()
    const row = testDb.prepare("SELECT is_resolved, resolved_at FROM symptom_events WHERE id = ?").get(id) as Record<string, unknown>
    expect(row.is_resolved).toBe(1)
    expect(row.resolved_at).not.toBeNull()
  })

  it("rejects an invalid write and inserts nothing", async () => {
    const { POST } = await import("@/app/api/symptom-events/route")
    const res = await POST(jsonRequest("http://localhost/api/symptom-events", "POST", {
      person_id: 1, label: "", start_date: "2026-08-01T09:00:00.000Z", severity: 2,
    }))
    expect(res.status).toBe(400)
    expect(testDb.prepare("SELECT COUNT(*) as n FROM symptom_events").get()).toEqual({ n: 0 })
  })

  it("PATCH updates fields and keeps resolved_at stable once already resolved", async () => {
    const { POST, PATCH } = await import("@/app/api/symptom-events/route")
    const createRes = await POST(jsonRequest("http://localhost/api/symptom-events", "POST", {
      person_id: 1, label: "Cough", start_date: "2026-08-01T09:00:00.000Z", severity: 2, is_resolved: true,
    }))
    const { id } = await createRes.json()
    const firstResolvedAt = (testDb.prepare("SELECT resolved_at FROM symptom_events WHERE id = ?").get(id) as { resolved_at: string }).resolved_at

    const patchRes = await PATCH(jsonRequest(`http://localhost/api/symptom-events?id=${id}`, "PATCH", {
      label: "Cough (worse)", start_date: "2026-08-01T09:00:00.000Z", severity: 4, is_resolved: true,
    }))
    expect(patchRes.status).toBe(200)

    const row = testDb.prepare("SELECT label, severity, resolved_at FROM symptom_events WHERE id = ?").get(id) as Record<string, unknown>
    expect(row.label).toBe("Cough (worse)")
    expect(row.severity).toBe(4)
    expect(row.resolved_at).toBe(firstResolvedAt)
  })

  it("PATCH clears resolved_at when un-resolving", async () => {
    const { POST, PATCH } = await import("@/app/api/symptom-events/route")
    const createRes = await POST(jsonRequest("http://localhost/api/symptom-events", "POST", {
      person_id: 1, label: "Cough", start_date: "2026-08-01T09:00:00.000Z", severity: 2, is_resolved: true,
    }))
    const { id } = await createRes.json()

    await PATCH(jsonRequest(`http://localhost/api/symptom-events?id=${id}`, "PATCH", {
      label: "Cough", start_date: "2026-08-01T09:00:00.000Z", severity: 2, is_resolved: false,
    }))

    const row = testDb.prepare("SELECT is_resolved, resolved_at FROM symptom_events WHERE id = ?").get(id) as Record<string, unknown>
    expect(row.is_resolved).toBe(0)
    expect(row.resolved_at).toBeNull()
  })

  it("PATCH on a still-open symptom counts as today's still-ongoing answer, and not once resolved", async () => {
    const { POST, PATCH } = await import("@/app/api/symptom-events/route")
    const { id } = await (await POST(jsonRequest("http://localhost/api/symptom-events", "POST", {
      person_id: 1, label: "Cough", start_date: "2026-09-30T00:00:00.000Z", severity: 2,
    }))).json()
    const confirmed = () => (testDb.prepare("SELECT ongoing_confirmed_on AS d FROM symptom_events WHERE id = ?").get(id) as { d: string | null }).d
    expect(confirmed()).toBeNull()

    await PATCH(jsonRequest(`http://localhost/api/symptom-events?id=${id}`, "PATCH", {
      label: "Cough", start_date: "2026-09-30T00:00:00.000Z", severity: 3,
    }))
    expect(confirmed()).toBe("2026-10-03")

    testDb.prepare("UPDATE symptom_events SET ongoing_confirmed_on = NULL WHERE id = ?").run(id)
    await PATCH(jsonRequest(`http://localhost/api/symptom-events?id=${id}`, "PATCH", {
      label: "Cough", start_date: "2026-09-30T00:00:00.000Z", severity: 3, is_resolved: true,
    }))
    expect(confirmed()).toBeNull()
  })

  it("DELETE removes the row", async () => {
    const { POST, DELETE } = await import("@/app/api/symptom-events/route")
    const createRes = await POST(jsonRequest("http://localhost/api/symptom-events", "POST", {
      person_id: 1, label: "Cough", start_date: "2026-08-01T09:00:00.000Z", severity: 2,
    }))
    const { id } = await createRes.json()

    const res = await DELETE(new NextRequest(`http://localhost/api/symptom-events?id=${id}`, { method: "DELETE" }))
    expect(res.status).toBe(200)
    expect(testDb.prepare("SELECT COUNT(*) as n FROM symptom_events WHERE id = ?").get(id)).toEqual({ n: 0 })
  })

  it("GET returns events for the authorised person", async () => {
    const { POST, GET } = await import("@/app/api/symptom-events/route")
    await POST(jsonRequest("http://localhost/api/symptom-events", "POST", {
      person_id: 1, label: "Cough", start_date: "2026-08-01T09:00:00.000Z", severity: 2,
    }))

    const res = await GET(new NextRequest("http://localhost/api/symptom-events?person_id=1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([
      { id: expect.any(Number), person_id: 1, label: "Cough", start_date: "2026-08-01T09:00:00.000Z", end_date: null, severity: 2, is_resolved: false, resolved_at: null, notes: null },
    ])
  })
})

describe("/api/symptom-events/labels", () => {
  beforeEach(() => {
    testDb = createTestDb()
    vi.resetModules()
    authorisePersonAccess.mockReset()
    authorisePersonAccess.mockReturnValue(PERSON)
    testDb.exec(`
      INSERT INTO symptom_events (person_id, label, start_date, severity) VALUES
        (1, 'Cough', '2026-08-01T09:00:00.000Z', 2),
        (1, 'cough', '2026-08-02T09:00:00.000Z', 3),
        (1, 'Headache', '2026-08-03T09:00:00.000Z', 1),
        (2, 'Fever', '2026-08-01T09:00:00.000Z', 4);
    `)
  })

  afterEach(() => {
    testDb?.close()
  })

  it("returns distinct labels for the person, case-insensitively ordered", async () => {
    const { GET } = await import("@/app/api/symptom-events/labels/route")
    const res = await GET(new NextRequest("http://localhost/api/symptom-events/labels?person_id=1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sort()).toEqual(["Headache", "Cough", "cough"].sort())
  })

  it("returns the ACL denial for an unauthorised person", async () => {
    authorisePersonAccess.mockReturnValue(NextResponse.json({ error: "Not found" }, { status: 404 }))
    const { GET } = await import("@/app/api/symptom-events/labels/route")
    const res = await GET(new NextRequest("http://localhost/api/symptom-events/labels?person_id=99"))
    expect(res.status).toBe(404)
  })
})
