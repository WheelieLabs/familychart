import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  resolveAgeTimezone,
  resolveEffectiveIanaTz,
  resolveInstanceTimezone,
  resolvePersonMedicationScheduleTzForPatch,
  resolveScheduleTzForWrite,
  validateScheduleIanaTz,
} from "@/lib/instance-timezone"
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
  `)
  return db
}

describe("resolveInstanceTimezone", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    delete process.env[ENV_KEY]
  })

  afterEach(() => {
    delete process.env[ENV_KEY]
    db?.close()
  })

  it("returns null when unset", () => {
    expect(resolveInstanceTimezone(db)).toBeNull()
  })

  it("resolveAgeTimezone falls back to UTC when unset", () => {
    expect(resolveAgeTimezone(db)).toBe("UTC")
  })

  it("returns db value when configured", () => {
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_LOCALE_DEFAULT_TIMEZONE,
      "Australia/Sydney",
      Date.now(),
    )
    expect(resolveInstanceTimezone(db)).toBe("Australia/Sydney")
    expect(resolveAgeTimezone(db)).toBe("Australia/Sydney")
  })

  it("prefers env over db", () => {
    process.env[ENV_KEY] = "Europe/London"
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_LOCALE_DEFAULT_TIMEZONE,
      "Australia/Sydney",
      Date.now(),
    )
    expect(resolveInstanceTimezone(db)).toBe("Europe/London")
  })
})

describe("resolveEffectiveIanaTz", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    delete process.env[ENV_KEY]
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_LOCALE_DEFAULT_TIMEZONE,
      "Australia/Sydney",
      Date.now(),
    )
  })

  afterEach(() => {
    delete process.env[ENV_KEY]
    db?.close()
  })

  it("prefers row tz when set", () => {
    expect(resolveEffectiveIanaTz("Pacific/Auckland", db)).toBe("Pacific/Auckland")
  })

  it("falls back to instance when row is null", () => {
    expect(resolveEffectiveIanaTz(null, db)).toBe("Australia/Sydney")
  })
})

describe("resolveScheduleTzForWrite", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    delete process.env[ENV_KEY]
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_LOCALE_DEFAULT_TIMEZONE,
      "Australia/Sydney",
      Date.now(),
    )
  })

  afterEach(() => {
    delete process.env[ENV_KEY]
    db?.close()
  })

  it("prefers explicit body tz", () => {
    expect(resolveScheduleTzForWrite("Pacific/Auckland", db)).toBe("Pacific/Auckland")
  })

  it("falls back to instance when body tz omitted", () => {
    expect(resolveScheduleTzForWrite(undefined, db)).toBe("Australia/Sydney")
    expect(resolveScheduleTzForWrite("", db)).toBe("Australia/Sydney")
  })

  it("returns null when neither body nor instance is set", () => {
    const emptyDb = createTestDb()
    expect(resolveScheduleTzForWrite(undefined, emptyDb)).toBeNull()
    emptyDb.close()
  })
})

describe("resolvePersonMedicationScheduleTzForPatch", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    delete process.env[ENV_KEY]
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_LOCALE_DEFAULT_TIMEZONE,
      "Australia/Sydney",
      Date.now(),
    )
  })

  afterEach(() => {
    delete process.env[ENV_KEY]
    db?.close()
  })

  it("uses explicit body tz when supplied", () => {
    expect(
      resolvePersonMedicationScheduleTzForPatch(
        { tz: "Europe/London" },
        null,
        true,
        db,
      ),
    ).toBe("Europe/London")
  })

  it("fills instance default when schedule active and tz omitted", () => {
    expect(
      resolvePersonMedicationScheduleTzForPatch({}, null, true, db),
    ).toBe("Australia/Sydney")
  })

  it("preserves existing row tz when instance unset and tz omitted", () => {
    const emptyDb = createTestDb()
    expect(
      resolvePersonMedicationScheduleTzForPatch({}, "Pacific/Auckland", true, emptyDb),
    ).toBe("Pacific/Auckland")
    emptyDb.close()
  })

  it("preserves existing tz when schedule inactive and tz omitted", () => {
    expect(
      resolvePersonMedicationScheduleTzForPatch({}, "Europe/London", false, db),
    ).toBe("Europe/London")
  })
})

describe("validateScheduleIanaTz", () => {
  it("accepts null and valid IANA", () => {
    expect(validateScheduleIanaTz(null)).toEqual({ ok: true, tz: null })
    expect(validateScheduleIanaTz("Australia/Sydney")).toEqual({
      ok: true,
      tz: "Australia/Sydney",
    })
  })

  it("rejects invalid IANA", () => {
    expect(validateScheduleIanaTz("Not/A/Timezone")).toEqual({
      ok: false,
      error: "Invalid timezone",
    })
  })
})
