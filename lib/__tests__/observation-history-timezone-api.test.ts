import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/auth/auth-helpers", () => ({
  requireAuth: vi.fn(async () => ({
    session: { user: { email: "u@test", id: "local:1", groups: ["local:read"] } },
    groups: ["local:read"],
  })),
  authorisePersonAccess: vi.fn(() => ({ id: 1, name: "Pat", account_uid: null })),
}))

let testDb: Database.Database

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
}))

// UTC-5 (New York in winter): `Date.getTimezoneOffset()` is +300 there.
const TZ_OFFSET_MINUTES = "300"

// 11:30 pm on 15 Jan local is 04:30 UTC on 16 Jan.
const LATE_EVENING_15TH = "2025-01-16T04:30:00.000Z"
// 11:30 pm on 14 Jan local is 04:30 UTC on 15 Jan.
const LATE_EVENING_14TH = "2025-01-15T04:30:00.000Z"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
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
    CREATE TABLE app_settings (
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (key)
    );
  `)
  const insert = db.prepare(
    "INSERT INTO observations (person_id, observation_type, value, unit, recorded_at) VALUES (1, 'Weight', ?, 'kg', ?)",
  )
  insert.run(70, LATE_EVENING_14TH)
  insert.run(71, LATE_EVENING_15TH)
  return db
}

const SCHEDULE_HEADERS = {
  "x-fc-local-today": "2025-01-15",
  "x-fc-tz-offset": TZ_OFFSET_MINUTES,
}

function getRequest(extraQuery: string, headers: Record<string, string>): NextRequest {
  return new NextRequest(
    `http://localhost/api/observations?person_id=1&type=Weight&from=2025-01-15&to=2025-01-15${extraQuery}`,
    { headers },
  )
}

async function valuesFor(extraQuery: string, headers: Record<string, string> = SCHEDULE_HEADERS): Promise<number[]> {
  const { GET } = await import("@/app/api/observations/route")
  const res = await GET(getRequest(extraQuery, headers))
  const body = await res.json() as
    | { value: number }[]
    | { rows: { value: number }[] }
  const rows = Array.isArray(body) ? body : body.rows
  return rows.map(r => r.value)
}

describe("observation history day boundaries use the client's local calendar", () => {
  beforeEach(() => {
    testDb = createTestDb()
    vi.resetModules()
  })

  afterEach(() => {
    testDb.close()
  })

  it("includes an 11:30 pm local reading in its own day, and excludes the previous evening's, in the list", async () => {
    expect(await valuesFor("")).toEqual([71])
  })

  it("applies the same local day to the paginated page", async () => {
    expect(await valuesFor("&limit=50")).toEqual([71])
  })

  it("applies the same local day to the chart data", async () => {
    expect(await valuesFor("&fields=chart")).toEqual([71])
  })

  describe("without the schedule headers", () => {
    beforeEach(() => {
      testDb
        .prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('locale.default_timezone', 'America/New_York', 0)")
        .run()
    })

    it("uses the instance timezone for the day, not UTC midnight", async () => {
      expect(await valuesFor("", {})).toEqual([71])
    })

    it("applies the instance timezone to a range with only one end", async () => {
      const { GET } = await import("@/app/api/observations/route")
      const res = await GET(
        new NextRequest("http://localhost/api/observations?person_id=1&type=Weight&from=2025-01-16"),
      )
      const rows = await res.json() as { value: number }[]
      expect(rows.map(r => r.value)).toEqual([])
    })
  })

  it("reads the day in UTC when the instance has no timezone and the request has no headers", async () => {
    // 04:30 UTC on 16 Jan is on 16 Jan in UTC, so the 15 Jan range holds only the 14 Jan evening's reading.
    expect(await valuesFor("", {})).toEqual([70])
  })
})
