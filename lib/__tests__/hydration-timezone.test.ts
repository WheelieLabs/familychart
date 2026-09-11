import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  getUserHydrationTimezone,
  loadUserHydrationTimezonesForUserUids,
  resolveHydrationLocalDay,
  resolveHydrationTimezone,
  setUserHydrationTimezone,
  USER_TIMEZONE_KEY,
} from "@/lib/hydration/hydration-timezone"
import { SETTING_LOCALE_DEFAULT_TIMEZONE } from "@/lib/settings/registry"

const ENV_KEY = "FC_DEFAULT_TIMEZONE"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE app_settings (
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (key)
    );
    CREATE TABLE user_settings (
      user_uid   TEXT NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_uid, key)
    );
    CREATE TABLE audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email  TEXT,
      action      TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id   INTEGER,
      details     TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
  return db
}

describe("resolveHydrationTimezone", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    delete process.env[ENV_KEY]
  })

  afterEach(() => {
    delete process.env[ENV_KEY]
    db?.close()
  })

  it("returns instance when env is set to a valid IANA zone", () => {
    process.env[ENV_KEY] = "Europe/London"
    expect(resolveHydrationTimezone(db)).toEqual({
      tz: "Europe/London",
      source: "instance",
    })
  })

  it("returns instance when only db is set to a valid IANA zone", () => {
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_LOCALE_DEFAULT_TIMEZONE,
      "Australia/Sydney",
      Date.now(),
    )
    expect(resolveHydrationTimezone(db)).toEqual({
      tz: "Australia/Sydney",
      source: "instance",
    })
  })

  it("returns fallback when neither env nor db is set", () => {
    expect(resolveHydrationTimezone(db)).toEqual({
      tz: null,
      source: "fallback",
    })
  })

  it("returns fallback when db row is empty string", () => {
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_LOCALE_DEFAULT_TIMEZONE,
      "",
      Date.now(),
    )
    expect(resolveHydrationTimezone(db)).toEqual({
      tz: null,
      source: "fallback",
    })
  })

  it("returns fallback when db row is an invalid IANA zone", () => {
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_LOCALE_DEFAULT_TIMEZONE,
      "Not/AZone",
      Date.now(),
    )
    expect(resolveHydrationTimezone(db)).toEqual({
      tz: null,
      source: "fallback",
    })
  })

  it("prefers env over db when both are set", () => {
    process.env[ENV_KEY] = "Europe/London"
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_LOCALE_DEFAULT_TIMEZONE,
      "Australia/Sydney",
      Date.now(),
    )
    expect(resolveHydrationTimezone(db)).toEqual({
      tz: "Europe/London",
      source: "instance",
    })
  })

  it("returns user when per-user tz is configured", () => {
    process.env[ENV_KEY] = "Europe/London"
    db.prepare(
      `INSERT INTO user_settings (user_uid, key, value, updated_at) VALUES (?, ?, ?, ?)`,
    ).run("uid-1", USER_TIMEZONE_KEY, "America/New_York", Date.now())

    expect(resolveHydrationTimezone(db, { userUid: "uid-1" })).toEqual({
      tz: "America/New_York",
      source: "user",
    })
  })

  it("prefers user tz over instance default", () => {
    process.env[ENV_KEY] = "Europe/London"
    expect(
      resolveHydrationTimezone(db, {
        userUid: "uid-1",
        userTz: "Pacific/Auckland",
      }),
    ).toEqual({
      tz: "Pacific/Auckland",
      source: "user",
    })
  })

  it("falls back to instance when user tz is invalid", () => {
    process.env[ENV_KEY] = "Europe/London"
    expect(
      resolveHydrationTimezone(db, {
        userUid: "uid-1",
        userTz: "Not/AZone",
      }),
    ).toEqual({
      tz: "Europe/London",
      source: "instance",
    })
  })

  it("falls back to instance when user tz is blank", () => {
    process.env[ENV_KEY] = "Australia/Sydney"
    expect(
      resolveHydrationTimezone(db, {
        userUid: "uid-1",
        userTz: "   ",
      }),
    ).toEqual({
      tz: "Australia/Sydney",
      source: "instance",
    })
  })

  it("returns fallback when user tz invalid and instance unset", () => {
    expect(
      resolveHydrationTimezone(db, {
        userUid: "uid-1",
        userTz: "Not/AZone",
      }),
    ).toEqual({
      tz: null,
      source: "fallback",
    })
  })
})

describe("user hydration timezone storage", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db?.close()
  })

  it("round-trips a valid user timezone", () => {
    setUserHydrationTimezone(db, "uid-1", "America/Chicago")
    expect(getUserHydrationTimezone(db, "uid-1")).toBe("America/Chicago")
  })

  it("clears user timezone when set to null", () => {
    setUserHydrationTimezone(db, "uid-1", "America/Chicago")
    setUserHydrationTimezone(db, "uid-1", null)
    expect(getUserHydrationTimezone(db, "uid-1")).toBeNull()
  })

  it("batch-loads user timezones", () => {
    setUserHydrationTimezone(db, "uid-1", "Europe/Paris")
    setUserHydrationTimezone(db, "uid-2", "Asia/Tokyo")
    const map = loadUserHydrationTimezonesForUserUids(db, ["uid-1", "uid-2", "uid-3"])
    expect(map.get("uid-1")).toBe("Europe/Paris")
    expect(map.get("uid-2")).toBe("Asia/Tokyo")
    expect(map.has("uid-3")).toBe(false)
  })

  it("rejects invalid timezone on write", () => {
    expect(() => setUserHydrationTimezone(db, "uid-1", "Not/AZone")).toThrow("Invalid timezone")
  })
})

describe("resolveHydrationLocalDay", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    process.env[ENV_KEY] = "UTC"
  })

  afterEach(() => {
    delete process.env[ENV_KEY]
    db?.close()
  })

  it("returns local ymd in user timezone", () => {
    const nowMs = Date.UTC(2026, 5, 23, 12, 0, 0)
    const resolved = resolveHydrationLocalDay(db, "uid-1", nowMs, {
      userTz: "Pacific/Auckland",
    })
    expect(resolved).toMatchObject({
      tz: "Pacific/Auckland",
      source: "user",
      ymd: "2026-06-24",
    })
    expect(resolved?.offsetMinutes).toBeTypeOf("number")
  })

  it("returns null when timezone cannot be resolved", () => {
    delete process.env[ENV_KEY]
    expect(resolveHydrationLocalDay(db, "uid-1", Date.now())).toBeNull()
  })
})
