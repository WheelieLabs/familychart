import Database from "better-sqlite3-multiple-ciphers"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resolveCalendarContext, parseClientNow, serverAuthoritativeLocalYmd } from "@/lib/calendar-context"
import { SETTING_LOCALE_DEFAULT_TIMEZONE } from "@/lib/settings/registry"

const ENV_KEY = "FC_DEFAULT_TIMEZONE"

// 2024-06-14 14:00:00 UTC
// In Australia/Sydney (UTC+10 winter): 2024-06-15 00:00 → ymd 2024-06-15
// In UTC+0: 2024-06-14 → ymd 2024-06-14
const NOW_MS = Date.UTC(2024, 5, 14, 14, 0, 0)

function createTestDb(instanceTz?: string): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE app_settings (
      key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (key)
    );
  `)
  if (instanceTz) {
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_LOCALE_DEFAULT_TIMEZONE,
      instanceTz,
      Date.now(),
    )
  }
  return db
}

function makeRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/", { headers })
}

describe("resolveCalendarContext — cron path (no request)", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    delete process.env[ENV_KEY]
  })

  afterEach(() => {
    delete process.env[ENV_KEY]
    db?.close()
  })

  it("returns null when no IANA configured", () => {
    expect(resolveCalendarContext(db, null, NOW_MS)).toBeNull()
    expect(resolveCalendarContext(db, undefined, NOW_MS)).toBeNull()
  })

  it("uses row tz when set (instance unset)", () => {
    const ctx = resolveCalendarContext(db, "Australia/Sydney", NOW_MS)
    expect(ctx?.ianaTz).toBe("Australia/Sydney")
    expect(ctx?.ymd).toBe("2024-06-15")
  })

  it("uses instance tz when row tz is null", () => {
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_LOCALE_DEFAULT_TIMEZONE,
      "Australia/Sydney",
      Date.now(),
    )
    const ctx = resolveCalendarContext(db, null, NOW_MS)
    expect(ctx?.ianaTz).toBe("Australia/Sydney")
    expect(ctx?.ymd).toBe("2024-06-15")
  })

  it("row tz wins over instance tz", () => {
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_LOCALE_DEFAULT_TIMEZONE,
      "Australia/Sydney",
      Date.now(),
    )
    const ctx = resolveCalendarContext(db, "Pacific/Auckland", NOW_MS)
    expect(ctx?.ianaTz).toBe("Pacific/Auckland")
  })

  it("returns offsetMinutes matching the resolved IANA zone", () => {
    // Africa/Abidjan is UTC+0 with no DST — offset is always 0
    const ctx = resolveCalendarContext(db, "Africa/Abidjan", NOW_MS)
    expect(ctx?.offsetMinutes).toBe(0)
  })
})

describe("resolveCalendarContext — route path (with request)", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    delete process.env[ENV_KEY]
  })

  afterEach(() => {
    delete process.env[ENV_KEY]
    db?.close()
  })

  it("uses client offset when no IANA configured", () => {
    const req = makeRequest({ "x-fc-tz-offset": "-600", "x-fc-local-today": "2024-06-15" })
    const ctx = resolveCalendarContext(db, null, NOW_MS, req)
    expect(ctx).not.toBeNull()
    expect(ctx?.ianaTz).toBeNull()
    expect(ctx?.ymd).toBe("2024-06-15")
    expect(ctx?.offsetMinutes).toBe(-600)
  })

  it("prefers IANA over client offset when instance tz is set", () => {
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_LOCALE_DEFAULT_TIMEZONE,
      "Australia/Sydney",
      Date.now(),
    )
    const req = makeRequest({ "x-fc-tz-offset": "0", "x-fc-local-today": "2024-06-14" })
    const ctx = resolveCalendarContext(db, null, NOW_MS, req)
    expect(ctx?.ianaTz).toBe("Australia/Sydney")
    expect(ctx?.ymd).toBe("2024-06-15")
  })

  it("row tz wins over instance tz with request", () => {
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_LOCALE_DEFAULT_TIMEZONE,
      "Australia/Sydney",
      Date.now(),
    )
    const req = makeRequest({ "x-fc-tz-offset": "0" })
    const ctx = resolveCalendarContext(db, "Pacific/Auckland", NOW_MS, req)
    expect(ctx?.ianaTz).toBe("Pacific/Auckland")
  })

  it("falls back to server-computed ymd when x-fc-local-today is absent", () => {
    const req = makeRequest({ "x-fc-tz-offset": "0" })
    const ctx = resolveCalendarContext(db, null, NOW_MS, req)
    expect(ctx).not.toBeNull()
    expect(ctx?.ymd).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it("uses server getTimezoneOffset fallback when x-fc-tz-offset is absent", () => {
    const req = makeRequest({ "x-fc-local-today": "2024-06-14" })
    const ctx = resolveCalendarContext(db, null, NOW_MS, req)
    expect(ctx).not.toBeNull()
    expect(typeof ctx?.offsetMinutes).toBe("number")
  })
})

describe("parseClientNow", () => {
  it("parses a valid ISO timestamp from x-fc-client-now", () => {
    const req = makeRequest({ "x-fc-client-now": "2024-06-15T10:00:00.000Z" })
    const d = parseClientNow(req)
    expect(d.toISOString()).toBe("2024-06-15T10:00:00.000Z")
  })

  it("falls back to approximately now when header is absent", () => {
    const before = Date.now()
    const req = makeRequest({})
    const d = parseClientNow(req)
    expect(d.getTime()).toBeGreaterThanOrEqual(before)
  })

  it("falls back when header is not a valid date", () => {
    const before = Date.now()
    const req = makeRequest({ "x-fc-client-now": "not-a-date" })
    const d = parseClientNow(req)
    expect(d.getTime()).toBeGreaterThanOrEqual(before)
  })
})

describe("serverAuthoritativeLocalYmd", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    delete process.env[ENV_KEY]
  })

  afterEach(() => {
    delete process.env[ENV_KEY]
    db?.close()
  })

  it("uses IANA row tz without reading client headers", () => {
    expect(serverAuthoritativeLocalYmd(db, "Australia/Sydney", NOW_MS)).toBe("2024-06-15")
  })

  it("falls back to process-local ymd when no IANA is configured", () => {
    const ymd = serverAuthoritativeLocalYmd(db, null, NOW_MS)
    expect(ymd).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it("uses instance tz when row tz is null", () => {
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_LOCALE_DEFAULT_TIMEZONE,
      "Australia/Sydney",
      Date.now(),
    )
    expect(serverAuthoritativeLocalYmd(db, null, NOW_MS)).toBe("2024-06-15")
  })
})
