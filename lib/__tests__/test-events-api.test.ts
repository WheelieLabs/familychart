import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const authorisePersonAccess = vi.fn()
const deleteUpload = vi.fn(async () => true)

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

vi.mock("@/lib/uploads/store", () => ({
  deleteUpload: (...args: unknown[]) => deleteUpload(...(args as Parameters<typeof deleteUpload>)),
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
  db.pragma("foreign_keys = ON")
  db.exec(`
    CREATE TABLE test_metric_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric_name TEXT NOT NULL UNIQUE,
      unit TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      aliases TEXT NOT NULL DEFAULT '[]',
      panel TEXT,
      value_type TEXT NOT NULL DEFAULT 'numeric'
    );
    CREATE TABLE test_events (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id      INTEGER NOT NULL,
      test_type      TEXT    NOT NULL,
      name           TEXT    NOT NULL,
      date           TEXT    NOT NULL,
      ordered_by     TEXT,
      notes          TEXT,
      attachment_url TEXT,
      created_by     TEXT,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE test_result_values (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      test_event_id     INTEGER NOT NULL REFERENCES test_events(id) ON DELETE CASCADE,
      metric_name       TEXT    NOT NULL,
      value_type        TEXT    NOT NULL,
      numeric_value     REAL,
      qualitative_value TEXT,
      unit              TEXT,
      reference_range   TEXT,
      flag              TEXT,
      limit_qualifier   TEXT
    );
    INSERT INTO test_metric_config (metric_name, unit, is_active) VALUES
      ('Haemoglobin', 'g/L', 1),
      ('COVID-19 RAT', null, 1);
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

describe("/api/test-events", () => {
  beforeEach(() => {
    testDb = createTestDb()
    vi.resetModules()
    authorisePersonAccess.mockReset()
    authorisePersonAccess.mockReturnValue(PERSON)
    deleteUpload.mockClear()
  })

  afterEach(() => {
    testDb?.close()
  })

  it("returns the ACL denial without inserting a row", async () => {
    authorisePersonAccess.mockReturnValue(NextResponse.json({ error: "Not found" }, { status: 404 }))
    const { POST } = await import("@/app/api/test-events/route")
    const res = await POST(jsonRequest("http://localhost/api/test-events", "POST", {
      person_id: 99, test_type: "Blood test", name: "FBC", date: "2026-08-01T09:00:00.000Z",
    }))
    expect(res.status).toBe(404)
    expect(testDb.prepare("SELECT COUNT(*) as n FROM test_events").get()).toEqual({ n: 0 })
  })

  it("creates a test event with structured values in one transaction", async () => {
    const { POST } = await import("@/app/api/test-events/route")
    const res = await POST(jsonRequest("http://localhost/api/test-events", "POST", {
      person_id: 1, test_type: "Blood test", name: "FBC", date: "2026-08-01T09:00:00.000Z",
      ordered_by: "Dr Smith", notes: "Fasting", attachment_url: "/api/test-results/uploads/11111111-1111-4111-8111-111111111111.pdf",
      values: [
        { metric_name: "Haemoglobin", value_type: "numeric", numeric_value: 135, unit: "g/L", reference_range: "115-165" },
        { metric_name: "COVID-19 RAT", value_type: "qualitative", qualitative_value: "Detected", flag: "differs from expected" },
      ],
    }))
    expect(res.status).toBe(201)
    const { id } = await res.json()

    const event = testDb.prepare("SELECT * FROM test_events WHERE id = ?").get(id) as Record<string, unknown>
    expect(event.name).toBe("FBC")
    expect(event.attachment_url).toBe("/api/test-results/uploads/11111111-1111-4111-8111-111111111111.pdf")

    const values = testDb.prepare("SELECT * FROM test_result_values WHERE test_event_id = ?").all(id)
    expect(values).toHaveLength(2)
  })

  it("accepts a freeform metric name when other: true is set", async () => {
    const { POST } = await import("@/app/api/test-events/route")
    const res = await POST(jsonRequest("http://localhost/api/test-events", "POST", {
      person_id: 1, test_type: "Blood test", name: "FBC", date: "2026-08-01T09:00:00.000Z",
      values: [{ metric_name: "Vitamin D (25-OH)", value_type: "numeric", numeric_value: 42, unit: "nmol/L", other: true }],
    }))
    expect(res.status).toBe(201)
    const { id } = await res.json()

    const values = testDb.prepare("SELECT metric_name, numeric_value FROM test_result_values WHERE test_event_id = ?").all(id)
    expect(values).toEqual([{ metric_name: "Vitamin D (25-OH)", numeric_value: 42 }])
  })

  it("rejects a value for an unknown metric and inserts nothing", async () => {
    const { POST } = await import("@/app/api/test-events/route")
    const res = await POST(jsonRequest("http://localhost/api/test-events", "POST", {
      person_id: 1, test_type: "Blood test", name: "FBC", date: "2026-08-01T09:00:00.000Z",
      values: [{ metric_name: "Not Real", value_type: "numeric", numeric_value: 1 }],
    }))
    expect(res.status).toBe(400)
    expect(testDb.prepare("SELECT COUNT(*) as n FROM test_events").get()).toEqual({ n: 0 })
  })

  it("PATCH replaces values via delete-and-reinsert", async () => {
    const { POST, PATCH } = await import("@/app/api/test-events/route")
    const createRes = await POST(jsonRequest("http://localhost/api/test-events", "POST", {
      person_id: 1, test_type: "Blood test", name: "FBC", date: "2026-08-01T09:00:00.000Z",
      values: [{ metric_name: "Haemoglobin", value_type: "numeric", numeric_value: 100 }],
    }))
    const { id } = await createRes.json()

    const patchRes = await PATCH(jsonRequest(`http://localhost/api/test-events?id=${id}`, "PATCH", {
      test_type: "Blood test", name: "FBC (repeat)", date: "2026-08-02T09:00:00.000Z",
      values: [{ metric_name: "Haemoglobin", value_type: "numeric", numeric_value: 140 }],
    }))
    expect(patchRes.status).toBe(200)

    const values = testDb.prepare("SELECT numeric_value FROM test_result_values WHERE test_event_id = ?").all(id)
    expect(values).toEqual([{ numeric_value: 140 }])
    const event = testDb.prepare("SELECT name FROM test_events WHERE id = ?").get(id)
    expect(event).toEqual({ name: "FBC (repeat)" })
  })

  it("DELETE cascades to test_result_values and deletes the attachment blob", async () => {
    const { POST, DELETE } = await import("@/app/api/test-events/route")
    const createRes = await POST(jsonRequest("http://localhost/api/test-events", "POST", {
      person_id: 1, test_type: "Blood test", name: "FBC", date: "2026-08-01T09:00:00.000Z",
      attachment_url: "/api/test-results/uploads/11111111-1111-4111-8111-111111111111.pdf",
      values: [{ metric_name: "Haemoglobin", value_type: "numeric", numeric_value: 100 }],
    }))
    const { id } = await createRes.json()

    const res = await DELETE(new NextRequest(`http://localhost/api/test-events?id=${id}`, { method: "DELETE" }))
    expect(res.status).toBe(200)
    expect(testDb.prepare("SELECT COUNT(*) as n FROM test_events WHERE id = ?").get(id)).toEqual({ n: 0 })
    expect(testDb.prepare("SELECT COUNT(*) as n FROM test_result_values WHERE test_event_id = ?").get(id)).toEqual({ n: 0 })
    expect(deleteUpload).toHaveBeenCalledWith("test-results", "11111111-1111-4111-8111-111111111111.pdf")
  })

  it("DELETE keeps the attachment blob while another test result still references it", async () => {
    const { POST, DELETE } = await import("@/app/api/test-events/route")
    const body = { person_id: 1, name: "FBC", date: "2026-08-01T09:00:00.000Z", attachment_url: "/api/test-results/uploads/22222222-2222-4222-8222-222222222222.pdf" }
    const first = await (await POST(jsonRequest("http://localhost/api/test-events", "POST", body))).json()
    await POST(jsonRequest("http://localhost/api/test-events", "POST", body))

    await DELETE(new NextRequest(`http://localhost/api/test-events?id=${first.id}`, { method: "DELETE" }))

    expect(deleteUpload).not.toHaveBeenCalled()
  })

  it("PATCH that replaces the attachment deletes the previous blob", async () => {
    const { POST, PATCH } = await import("@/app/api/test-events/route")
    const { id } = await (await POST(jsonRequest("http://localhost/api/test-events", "POST", {
      person_id: 1, name: "FBC", date: "2026-08-01T09:00:00.000Z", attachment_url: "/api/test-results/uploads/33333333-3333-4333-8333-333333333333.pdf",
    }))).json()

    const res = await PATCH(jsonRequest(`http://localhost/api/test-events?id=${id}`, "PATCH", {
      name: "FBC", date: "2026-08-01T09:00:00.000Z", attachment_url: "/api/test-results/uploads/44444444-4444-4444-8444-444444444444.pdf",
    }))

    expect(res.status).toBe(200)
    expect(deleteUpload).toHaveBeenCalledWith("test-results", "33333333-3333-4333-8333-333333333333.pdf")
    expect(deleteUpload).not.toHaveBeenCalledWith("test-results", "44444444-4444-4444-8444-444444444444.pdf")
  })

  it("PATCH that removes the attachment deletes the blob; one that keeps it does not", async () => {
    const { POST, PATCH } = await import("@/app/api/test-events/route")
    const { id } = await (await POST(jsonRequest("http://localhost/api/test-events", "POST", {
      person_id: 1, name: "FBC", date: "2026-08-01T09:00:00.000Z", attachment_url: "/api/test-results/uploads/55555555-5555-4555-8555-555555555555.pdf",
    }))).json()

    await PATCH(jsonRequest(`http://localhost/api/test-events?id=${id}`, "PATCH", {
      name: "FBC (edited)", date: "2026-08-01T09:00:00.000Z", attachment_url: "/api/test-results/uploads/55555555-5555-4555-8555-555555555555.pdf",
    }))
    expect(deleteUpload).not.toHaveBeenCalled()

    await PATCH(jsonRequest(`http://localhost/api/test-events?id=${id}`, "PATCH", {
      name: "FBC", date: "2026-08-01T09:00:00.000Z", attachment_url: null,
    }))
    expect(deleteUpload).toHaveBeenCalledWith("test-results", "55555555-5555-4555-8555-555555555555.pdf")
  })

  it("GET returns events with nested structured values for the authorised person", async () => {
    const { POST, GET } = await import("@/app/api/test-events/route")
    await POST(jsonRequest("http://localhost/api/test-events", "POST", {
      person_id: 1, test_type: "Blood test", name: "FBC", date: "2026-08-01T09:00:00.000Z",
      values: [{ metric_name: "Haemoglobin", value_type: "numeric", numeric_value: 135, unit: "g/L" }],
    }))

    const res = await GET(new NextRequest("http://localhost/api/test-events?person_id=1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].values).toEqual([
      { metric_name: "Haemoglobin", value_type: "numeric", numeric_value: 135, qualitative_value: null, unit: "g/L", reference_range: null, flag: null, limit_qualifier: null },
    ])
  })

  it("round-trips a limit qualifier and accepts an event with no test_type", async () => {
    const { POST, GET } = await import("@/app/api/test-events/route")
    const created = await POST(jsonRequest("http://localhost/api/test-events", "POST", {
      person_id: 1, name: "Iron Studies", date: "2026-08-01T02:30:00.000Z",
      values: [{ metric_name: "Haemoglobin", value_type: "numeric", numeric_value: 20, limit_qualifier: "<", unit: "g/L" }],
    }))
    expect(created.status).toBe(201)

    const res = await GET(new NextRequest("http://localhost/api/test-events?person_id=1"))
    const body = await res.json()
    expect(body[0].test_type).toBe("")
    expect(body[0].values[0]).toMatchObject({ numeric_value: 20, limit_qualifier: "<" })
  })
  describe("attachment_url hardening", () => {
    const B_FILE = "66666666-6666-4666-8666-666666666666.pdf"
    const B_URL = `/api/test-results/uploads/${B_FILE}`
    const base = { person_id: 1, name: "FBC", date: "2026-08-01T09:00:00.000Z" }

    function seedPersonBEvent() {
      testDb.prepare(
        "INSERT INTO test_events (person_id, test_type, name, date, attachment_url) VALUES (2, 'Blood test', 'B', '2026-08-01', ?)",
      ).run(B_URL)
    }

    it.each([
      `x/${B_FILE}`,
      `/api/test-results/uploads/../${B_FILE}`,
      `/api/test-results/uploads/x/${B_FILE}`,
      "/api/test-results/uploads/abc.pdf",
      `/api/test-results/uploads/${B_FILE.replace(".pdf", ".exe")}`,
      `https://evil.example${B_URL}`,
    ])("POST rejects non-canonical attachment_url %s", async (url) => {
      const { POST } = await import("@/app/api/test-events/route")
      const res = await POST(jsonRequest("http://localhost/api/test-events", "POST", { ...base, attachment_url: url }))
      expect(res.status).toBe(400)
      expect(testDb.prepare("SELECT COUNT(*) as n FROM test_events").get()).toEqual({ n: 0 })
    })

    it("POST rejects a URL already referenced by another Person's event", async () => {
      seedPersonBEvent()
      const { POST } = await import("@/app/api/test-events/route")
      const res = await POST(jsonRequest("http://localhost/api/test-events", "POST", { ...base, attachment_url: B_URL }))
      expect(res.status).toBe(400)
      expect(testDb.prepare("SELECT COUNT(*) as n FROM test_events WHERE person_id = 1").get()).toEqual({ n: 0 })
    })

    it("PATCH rejects a variant or cross-Person URL and leaves the event untouched", async () => {
      seedPersonBEvent()
      const { POST, PATCH } = await import("@/app/api/test-events/route")
      const { id } = await (await POST(jsonRequest("http://localhost/api/test-events", "POST", base))).json()
      for (const url of [`x/${B_FILE}`, B_URL]) {
        const res = await PATCH(jsonRequest(`http://localhost/api/test-events?id=${id}`, "PATCH", { ...base, attachment_url: url }))
        expect(res.status).toBe(400)
      }
      expect(testDb.prepare("SELECT attachment_url FROM test_events WHERE id = ?").get(id)).toEqual({ attachment_url: null })
    })

    it("DELETE of a legacy variant-URL event never deletes another Person's blob", async () => {
      seedPersonBEvent()
      testDb.prepare(
        "INSERT INTO test_events (person_id, name, date, test_type, attachment_url) VALUES (1, 'A', '2026-08-01', '', ?)",
      ).run(`x/${B_FILE}`)
      const legacyId = Number(testDb.prepare("SELECT last_insert_rowid() AS n").pluck().get())
      const { DELETE } = await import("@/app/api/test-events/route")
      const res = await DELETE(new NextRequest(`http://localhost/api/test-events?id=${legacyId}`, { method: "DELETE" }))
      expect(res.status).toBe(200)
      expect(deleteUpload).not.toHaveBeenCalled()
    })
  })
})
