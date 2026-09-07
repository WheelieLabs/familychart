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
    CREATE TABLE observation_type_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      observation_type TEXT NOT NULL UNIQUE,
      is_static INTEGER NOT NULL DEFAULT 0,
      chart_type TEXT,
      typical_unit TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      max_age_years INTEGER,
      stale_after_hours INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO observation_type_config
      (observation_type, is_static, chart_type, typical_unit, sort_order, is_active)
    VALUES
      ('Hydration', 0, 'bar', 'mL', 10, 1),
      ('Legacy Custom', 0, 'line', 'x', 99, 1),
      ('Retired', 0, 'line', null, 98, 0);
  `)
  return db
}

describe("/api/observation-type-config", () => {
  beforeEach(() => {
    testDb = createTestDb()
    vi.resetModules()
  })

  afterEach(() => {
    testDb?.close()
  })

  it("rejects POST create (curated catalogue only)", async () => {
    const { POST } = await import("@/app/api/observation-type-config/route")
    const res = await POST()
    expect(res.status).toBe(405)
    const body = await res.json()
    expect(body.error).toMatch(/not supported/i)
  })
})

describe("/api/observation-type-config/[id]", () => {
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
    const { PATCH } = await import("@/app/api/observation-type-config/[id]/route")
    const req = new NextRequest("http://localhost/api/observation-type-config/1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chart_type: "table", is_active: 1 }),
    })
    const res = await PATCH(req, params(1))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/only is_active/i)
  })

  it("toggles is_active on a catalogue row", async () => {
    const { PATCH } = await import("@/app/api/observation-type-config/[id]/route")
    const req = new NextRequest("http://localhost/api/observation-type-config/1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: 0 }),
    })
    const res = await PATCH(req, params(1))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, is_active: 0 })

    const row = testDb
      .prepare("SELECT is_active FROM observation_type_config WHERE id = 1")
      .get() as { is_active: number }
    expect(row.is_active).toBe(0)
  })

  it("allows toggling a grandfathered custom type", async () => {
    const { PATCH } = await import("@/app/api/observation-type-config/[id]/route")
    const custom = testDb
      .prepare("SELECT id FROM observation_type_config WHERE observation_type = 'Legacy Custom'")
      .get() as { id: number }

    const deactivate = new NextRequest(`http://localhost/api/observation-type-config/${custom.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: 0 }),
    })
    const resOff = await PATCH(deactivate, params(custom.id))
    expect(resOff.status).toBe(200)

    const reactivate = new NextRequest(`http://localhost/api/observation-type-config/${custom.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: 1 }),
    })
    const resOn = await PATCH(reactivate, params(custom.id))
    expect(resOn.status).toBe(200)

    const row = testDb
      .prepare("SELECT is_active FROM observation_type_config WHERE id = ?")
      .get(custom.id) as { is_active: number }
    expect(row.is_active).toBe(1)
  })

  it("soft-deactivates via DELETE instead of hard-deleting", async () => {
    const { DELETE } = await import("@/app/api/observation-type-config/[id]/route")
    const res = await DELETE(
      new NextRequest("http://localhost/api/observation-type-config/1", { method: "DELETE" }),
      params(1),
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, action: "deactivated" })

    const row = testDb
      .prepare("SELECT id, is_active FROM observation_type_config WHERE observation_type = 'Hydration'")
      .get() as { id: number; is_active: number } | undefined
    expect(row).toBeTruthy()
    expect(row!.is_active).toBe(0)
  })
})
