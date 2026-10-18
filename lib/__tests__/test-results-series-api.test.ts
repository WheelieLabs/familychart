import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const authorisePersonAccess = vi.fn()

vi.mock("@/lib/auth/auth-helpers", () => ({
  requireAuth: vi.fn(async () => ({ session: { user: { id: "local:1" } }, groups: ["local:read"] })),
  authorisePersonAccess: (...args: unknown[]) => authorisePersonAccess(...args),
}))

let testDb: Database.Database
vi.mock("@/lib/db", () => ({ getDb: () => testDb }))

describe("GET /api/test-results/series", () => {
  beforeEach(() => {
    testDb = new Database(":memory:")
    testDb.exec(`
      CREATE TABLE test_metric_config (id INTEGER PRIMARY KEY, metric_name TEXT, sort_order INTEGER, is_active INTEGER, panel TEXT, aliases TEXT);
      CREATE TABLE app_settings (key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (key));
      CREATE TABLE test_events (id INTEGER PRIMARY KEY, person_id INTEGER, date TEXT);
      CREATE TABLE test_result_values (id INTEGER PRIMARY KEY, test_event_id INTEGER, metric_name TEXT, value_type TEXT,
        numeric_value REAL, unit TEXT, reference_range TEXT, flag TEXT, limit_qualifier TEXT);
      INSERT INTO test_events VALUES (1, 1, '2026-01-10T00:00:00.000Z'), (2, 1, '2026-03-10T00:00:00.000Z');
      INSERT INTO test_result_values (test_event_id, metric_name, value_type, numeric_value, unit) VALUES
        (1, 'Sodium', 'numeric', 140, 'mmol/L'), (2, 'Sodium', 'numeric', 138, 'mmol/L');
    `)
    authorisePersonAccess.mockReset()
    authorisePersonAccess.mockReturnValue({ id: 1 })
  })
  afterEach(() => testDb.close())

  async function get(qs: string) {
    const { GET } = await import("@/app/api/test-results/series/route")
    return GET(new NextRequest(`http://localhost/api/test-results/series?${qs}`))
  }

  it("requires person_id", async () => {
    expect((await get("")).status).toBe(400)
  })

  it("returns the same denial as the test events API for a person the caller cannot read", async () => {
    authorisePersonAccess.mockReturnValue(NextResponse.json({ error: "Not found" }, { status: 404 }))
    const res = await get("person_id=9")
    expect(authorisePersonAccess).toHaveBeenCalledWith(testDb, expect.anything(), 9, "read")
    expect(res.status).toBe(404)
  })

  it("lists series without a metric, and returns points with one", async () => {
    const list = await (await get("person_id=1")).json()
    expect(list.series[0]).toMatchObject({ metric_name: "Sodium", count: 2 })
    const points = await (await get("person_id=1&metric=Sodium&unit=mmol%2FL&from=2026-02-01&to=2026-04-01")).json()
    expect(points).toHaveLength(1)
    expect(points[0].value).toBe(138)
  })
})
