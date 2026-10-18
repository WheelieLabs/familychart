import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const authorisePersonAccess = vi.fn()
const auditLog = vi.fn()

vi.mock("@/lib/auth/auth-helpers", () => ({
  requireAuth: vi.fn(async () => ({
    session: { user: { email: "demo@test", id: "local:1", groups: ["local:write"] } },
    groups: ["local:write"],
  })),
  authorisePersonAccess: (...args: unknown[]) =>
    authorisePersonAccess(...(args as Parameters<typeof authorisePersonAccess>)),
}))

let testDb: Database.Database

vi.mock("@/lib/db", () => ({ getDb: () => testDb }))
vi.mock("@/lib/audit-log", () => ({ auditLog: (...args: unknown[]) => auditLog(...args) }))
// Local day fixed to 2026-10-03 at UTC+0 so the test does not depend on the machine's timezone.
vi.mock("@/lib/calendar-context", () => ({
  resolveCalendarContext: () => ({ ymd: "2026-10-03", offsetMinutes: 0, ianaTz: null }),
}))

const PERSON = { id: 1, name: "Pat", account_uid: null, is_active: 1 }

function post(id: number | string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/symptom-events/${id}/answer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/symptom-events/[id]/answer", () => {
  beforeEach(() => {
    testDb = new Database(":memory:")
    testDb.exec(`CREATE TABLE symptom_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, person_id INTEGER NOT NULL, label TEXT NOT NULL,
      start_date TEXT NOT NULL, end_date TEXT, severity INTEGER NOT NULL DEFAULT 2,
      is_resolved INTEGER NOT NULL DEFAULT 0, resolved_at TEXT, notes TEXT, ongoing_confirmed_on TEXT
    )`)
    testDb.prepare("INSERT INTO symptom_events (person_id, label, start_date) VALUES (1, 'Headache', '2026-10-01T00:00:00.000Z')").run()
    vi.resetModules()
    authorisePersonAccess.mockReset()
    authorisePersonAccess.mockReturnValue(PERSON)
    auditLog.mockReset()
  })

  afterEach(() => testDb?.close())

  const row = () => testDb.prepare("SELECT * FROM symptom_events WHERE id = 1").get() as Record<string, unknown>
  const call = async (id: number | string, body: Record<string, unknown>) => {
    const { POST } = await import("@/app/api/symptom-events/[id]/answer/route")
    return POST(post(id, body), { params: Promise.resolve({ id: String(id) }) })
  }

  it("asks for write access to the symptom's person and changes nothing when denied", async () => {
    authorisePersonAccess.mockReturnValue(NextResponse.json({ error: "Not found" }, { status: 404 }))
    const res = await call(1, { outcome: "resolved" })
    expect(res.status).toBe(404)
    expect(authorisePersonAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), 1, "write")
    expect(row().is_resolved).toBe(0)
    expect(auditLog).not.toHaveBeenCalled()
  })

  it("records Still ongoing for today and audit-logs it", async () => {
    const res = await call(1, { outcome: "ongoing" })
    expect(res.status).toBe(200)
    expect(row().ongoing_confirmed_on).toBe("2026-10-03")
    expect(row().is_resolved).toBe(0)
    expect(auditLog).toHaveBeenCalledWith(expect.anything(), "demo@test", "UPDATE", "symptom_events", 1, expect.objectContaining({ answer: "ongoing" }))
  })

  it("resolves with end_date today, or an earlier chosen day", async () => {
    const res = await call(1, { outcome: "resolved" })
    expect(res.status).toBe(200)
    expect(row().is_resolved).toBe(1)
    expect(row().end_date).toBe("2026-10-03T00:00:00.000Z")
    expect(row().resolved_at).toBeTruthy()

    testDb.prepare("UPDATE symptom_events SET is_resolved = 0, end_date = NULL, resolved_at = NULL").run()
    const earlier = await call(1, { outcome: "resolved", resolved_ymd: "2026-10-02" })
    expect(earlier.status).toBe(200)
    expect(row().end_date).toBe("2026-10-02T00:00:00.000Z")
  })

  it("rejects a bad outcome, a bad date and a symptom that is already closed", async () => {
    expect((await call(1, { outcome: "snooze" })).status).toBe(400)
    expect((await call(1, { outcome: "resolved", resolved_ymd: "2026-09-01" })).status).toBe(400)
    expect((await call(1, { outcome: "resolved", resolved_ymd: 5 })).status).toBe(400)
    await call(1, { outcome: "resolved" })
    expect((await call(1, { outcome: "ongoing" })).status).toBe(409)
  })

  it("returns 404 for an unknown symptom and 400 for a malformed id", async () => {
    expect((await call(999, { outcome: "ongoing" })).status).toBe(404)
    expect((await call("abc", { outcome: "ongoing" })).status).toBe(400)
  })
})
