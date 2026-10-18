import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/auth/auth-helpers", () => ({
  requireManage: vi.fn(async () => ({
    session: { user: { email: "mgr@test" } },
    groups: ["manage"],
  })),
  requireRead: vi.fn(async () => ({
    session: { user: { email: "mgr@test" } },
    groups: ["manage"],
  })),
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
    INSERT INTO test_metric_config (metric_name, unit, sort_order, is_active)
    VALUES
      ('Haemoglobin', 'g/L', 1, 1),
      ('Retired Metric', null, 98, 0);
  `)
  return db
}

describe("/api/test-metric-config", () => {
  beforeEach(() => {
    testDb = createTestDb()
    vi.resetModules()
  })

  afterEach(() => {
    testDb?.close()
  })

  it("rejects POST create (curated catalogue only)", async () => {
    const { POST } = await import("@/app/api/test-metric-config/route")
    const res = await POST()
    expect(res.status).toBe(405)
    const body = await res.json()
    expect(body.error).toMatch(/not supported/i)
  })
})

describe("/api/test-metric-config/[id]", () => {
  beforeEach(() => {
    testDb = createTestDb()
    vi.resetModules()
  })

  afterEach(() => {
    testDb?.close()
  })

  function params(id: number) {
    return { params: Promise.resolve({ id: String(id) }) }
  }

  it("rejects metadata PATCH", async () => {
    const { PATCH } = await import("@/app/api/test-metric-config/[id]/route")
    const req = new NextRequest("http://localhost/api/test-metric-config/1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unit: "mmol/L", is_active: 1 }),
    })
    const res = await PATCH(req, params(1))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/only is_active/i)
  })

  it("toggles is_active on a catalogue row", async () => {
    const { PATCH } = await import("@/app/api/test-metric-config/[id]/route")
    const req = new NextRequest("http://localhost/api/test-metric-config/1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: 0 }),
    })
    const res = await PATCH(req, params(1))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, is_active: 0 })

    const row = testDb
      .prepare("SELECT is_active FROM test_metric_config WHERE id = 1")
      .get() as { is_active: number }
    expect(row.is_active).toBe(0)
  })

  it("soft-deactivates via DELETE instead of hard-deleting", async () => {
    const { DELETE } = await import("@/app/api/test-metric-config/[id]/route")
    const res = await DELETE(
      new NextRequest("http://localhost/api/test-metric-config/1", { method: "DELETE" }),
      params(1),
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, action: "deactivated" })

    const row = testDb
      .prepare("SELECT id, is_active FROM test_metric_config WHERE metric_name = 'Haemoglobin'")
      .get() as { id: number; is_active: number } | undefined
    expect(row).toBeTruthy()
    expect(row!.is_active).toBe(0)
  })

  it("404s for an unknown id", async () => {
    const { PATCH } = await import("@/app/api/test-metric-config/[id]/route")
    const req = new NextRequest("http://localhost/api/test-metric-config/999", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: 0 }),
    })
    const res = await PATCH(req, params(999))
    expect(res.status).toBe(404)
  })
})
