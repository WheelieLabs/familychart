import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, it, expect } from "vitest"
import {
  DEFAULT_ACTIVE_END,
  DEFAULT_ACTIVE_START,
  DEFAULT_GLASS_SIZE,
  FLAT_ACTIVE_END_MIN,
  FLAT_ACTIVE_START_MIN,
  HYDRATION_KEY_ACTIVE_END,
  HYDRATION_KEY_ACTIVE_START,
  HYDRATION_KEY_GLASS_SIZE,
  HYDRATION_KEY_LAST_NUDGE_AT,
  HYDRATION_KEY_LAST_RECORD_AT,
  HYDRATION_KEY_MUTED_UNTIL,
  isHydrationMutedForLocalDay,
  patchBodyToPartial,
  resolveHydrationConfigFromStored,
  resolveHydrationWindowMinutesFromStored,
  getHydrationConfigForUserUids,
  mergeHydrationStoredForCandidateUids,
  setHydrationConfig,
  setHydrationMutedForLocalDay,
  validateHydrationConfigPartial,
} from "@/lib/hydration/hydration-config"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE user_settings (
      user_uid    TEXT NOT NULL,
      key         TEXT NOT NULL,
      value       TEXT NOT NULL,
      updated_at  INTEGER NOT NULL,
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

function hydrationKeysInDb(db: Database.Database, userUid: string): string[] {
  return (
    db
      .prepare(
        `SELECT key FROM user_settings
         WHERE user_uid = ? AND key IN (?, ?, ?)
         ORDER BY key`
      )
      .all(userUid, HYDRATION_KEY_ACTIVE_START, HYDRATION_KEY_ACTIVE_END, HYDRATION_KEY_GLASS_SIZE) as {
      key: string
    }[]
  ).map(row => row.key)
}

describe("resolveHydrationConfigFromStored", () => {
  it("returns defaults when no values are stored", () => {
    expect(resolveHydrationConfigFromStored({})).toEqual({
      activeStart: DEFAULT_ACTIVE_START,
      activeEnd: DEFAULT_ACTIVE_END,
      glassSize: DEFAULT_GLASS_SIZE,
    })
  })

  it("reads stored values and normalises times", () => {
    expect(
      resolveHydrationConfigFromStored({
        [HYDRATION_KEY_ACTIVE_START]: "7:00",
        [HYDRATION_KEY_ACTIVE_END]: "21:30",
        [HYDRATION_KEY_GLASS_SIZE]: "300",
      })
    ).toEqual({
      activeStart: "07:00",
      activeEnd: "21:30",
      glassSize: 300,
    })
  })

  it("falls back to defaults for missing keys in a partial store", () => {
    expect(
      resolveHydrationConfigFromStored({
        [HYDRATION_KEY_GLASS_SIZE]: "400",
      })
    ).toEqual({
      activeStart: DEFAULT_ACTIVE_START,
      activeEnd: DEFAULT_ACTIVE_END,
      glassSize: 400,
    })
  })
})

describe("resolveHydrationWindowMinutesFromStored", () => {
  it("returns flat pacing for null user_uid", () => {
    expect(resolveHydrationWindowMinutesFromStored(null, {})).toEqual({
      activeStartMin: FLAT_ACTIVE_START_MIN,
      activeEndMin: FLAT_ACTIVE_END_MIN,
      glassSize: DEFAULT_GLASS_SIZE,
    })
  })

  it("returns flat pacing for empty user_uid", () => {
    expect(resolveHydrationWindowMinutesFromStored("  ", {})).toEqual({
      activeStartMin: FLAT_ACTIVE_START_MIN,
      activeEndMin: FLAT_ACTIVE_END_MIN,
      glassSize: DEFAULT_GLASS_SIZE,
    })
  })

  it("returns flat pacing when user has no stored window", () => {
    expect(resolveHydrationWindowMinutesFromStored("local:1", {})).toEqual({
      activeStartMin: FLAT_ACTIVE_START_MIN,
      activeEndMin: FLAT_ACTIVE_END_MIN,
      glassSize: DEFAULT_GLASS_SIZE,
    })
  })

  it("returns flat pacing with stored glass size when window is absent", () => {
    expect(
      resolveHydrationWindowMinutesFromStored("local:1", {
        [HYDRATION_KEY_GLASS_SIZE]: "400",
      })
    ).toEqual({
      activeStartMin: FLAT_ACTIVE_START_MIN,
      activeEndMin: FLAT_ACTIVE_END_MIN,
      glassSize: 400,
    })
  })

  it("returns configured minutes when both window keys are stored", () => {
    expect(
      resolveHydrationWindowMinutesFromStored("local:1", {
        [HYDRATION_KEY_ACTIVE_START]: "08:00",
        [HYDRATION_KEY_ACTIVE_END]: "20:00",
        [HYDRATION_KEY_GLASS_SIZE]: "300",
      })
    ).toEqual({
      activeStartMin: 8 * 60,
      activeEndMin: 20 * 60,
      glassSize: 300,
    })
  })

  it("returns flat pacing when only one window key is stored", () => {
    expect(
      resolveHydrationWindowMinutesFromStored("local:1", {
        [HYDRATION_KEY_ACTIVE_START]: "08:00",
      })
    ).toEqual({
      activeStartMin: FLAT_ACTIVE_START_MIN,
      activeEndMin: FLAT_ACTIVE_END_MIN,
      glassSize: DEFAULT_GLASS_SIZE,
    })
  })

  it("resolves different windows for two people from separate stored configs", () => {
    const configured = resolveHydrationWindowMinutesFromStored("user-a", {
      [HYDRATION_KEY_ACTIVE_START]: "07:00",
      [HYDRATION_KEY_ACTIVE_END]: "21:00",
    })
    const nonUser = resolveHydrationWindowMinutesFromStored(null, {})
    const unconfiguredUser = resolveHydrationWindowMinutesFromStored("user-b", {})

    expect(configured).toEqual({
      activeStartMin: 7 * 60,
      activeEndMin: 21 * 60,
      glassSize: DEFAULT_GLASS_SIZE,
    })
    expect(nonUser.activeStartMin).toBe(FLAT_ACTIVE_START_MIN)
    expect(nonUser.activeEndMin).toBe(FLAT_ACTIVE_END_MIN)
    expect(unconfiguredUser.activeStartMin).toBe(FLAT_ACTIVE_START_MIN)
    expect(unconfiguredUser.activeEndMin).toBe(FLAT_ACTIVE_END_MIN)
    expect(configured.activeStartMin).not.toBe(nonUser.activeStartMin)
  })
})

describe("patchBodyToPartial", () => {
  it("maps snake_case API fields to partial config", () => {
    expect(
      patchBodyToPartial({
        active_start: "08:00",
        active_end: "20:00",
        glass_size: 200,
      })
    ).toEqual({
      activeStart: "08:00",
      activeEnd: "20:00",
      glassSize: 200,
    })
  })
})

describe("mergeHydrationStoredForCandidateUids", () => {
  it("prefers custom pacing values over profile defaults across linked uids", () => {
    const rows = [
      {
        user_uid: "canonical",
        key: HYDRATION_KEY_ACTIVE_START,
        value: "07:00",
        updated_at: 200,
      },
      {
        user_uid: "canonical",
        key: HYDRATION_KEY_ACTIVE_END,
        value: "21:00",
        updated_at: 200,
      },
      {
        user_uid: "legacy",
        key: HYDRATION_KEY_ACTIVE_START,
        value: "09:00",
        updated_at: 100,
      },
      {
        user_uid: "legacy",
        key: HYDRATION_KEY_ACTIVE_END,
        value: "22:00",
        updated_at: 100,
      },
    ]

    expect(mergeHydrationStoredForCandidateUids(rows, ["canonical", "legacy"])).toEqual({
      [HYDRATION_KEY_ACTIVE_START]: "09:00",
      [HYDRATION_KEY_ACTIVE_END]: "22:00",
    })
  })

  it("uses the latest nudge and record anchors across linked uids", () => {
    const rows = [
      {
        user_uid: "canonical",
        key: HYDRATION_KEY_LAST_NUDGE_AT,
        value: "1000",
        updated_at: 100,
      },
      {
        user_uid: "legacy",
        key: HYDRATION_KEY_LAST_NUDGE_AT,
        value: "2000",
        updated_at: 100,
      },
      {
        user_uid: "canonical",
        key: HYDRATION_KEY_LAST_RECORD_AT,
        value: "3000",
        updated_at: 100,
      },
      {
        user_uid: "legacy",
        key: HYDRATION_KEY_LAST_RECORD_AT,
        value: "1500",
        updated_at: 100,
      },
    ]

    expect(mergeHydrationStoredForCandidateUids(rows, ["canonical", "legacy"])).toEqual({
      [HYDRATION_KEY_LAST_NUDGE_AT]: "2000",
      [HYDRATION_KEY_LAST_RECORD_AT]: "3000",
    })
  })
})

describe("getHydrationConfigForUserUids", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db?.close()
  })

  it("prefers custom values over profile defaults across linked uids", () => {
    db.prepare(
      `INSERT INTO user_settings (user_uid, key, value, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run("canonical", HYDRATION_KEY_ACTIVE_START, "07:00", 200)
    db.prepare(
      `INSERT INTO user_settings (user_uid, key, value, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run("canonical", HYDRATION_KEY_ACTIVE_END, "21:00", 200)
    db.prepare(
      `INSERT INTO user_settings (user_uid, key, value, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run("legacy", HYDRATION_KEY_ACTIVE_START, "09:00", 100)
    db.prepare(
      `INSERT INTO user_settings (user_uid, key, value, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run("legacy", HYDRATION_KEY_ACTIVE_END, "22:00", 100)

    expect(getHydrationConfigForUserUids(db, ["canonical", "legacy"])).toEqual({
      activeStart: "09:00",
      activeEnd: "22:00",
      glassSize: DEFAULT_GLASS_SIZE,
    })
  })
})

describe("setHydrationConfig", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db?.close()
  })

  it("upserts all three config keys on a partial patch", () => {
    setHydrationConfig(db, "local:1", { glassSize: 300 })

    expect(hydrationKeysInDb(db, "local:1")).toEqual([
      HYDRATION_KEY_ACTIVE_END,
      HYDRATION_KEY_ACTIVE_START,
      HYDRATION_KEY_GLASS_SIZE,
    ])
  })

  it("persists existing values for keys not in the patch", () => {
    setHydrationConfig(db, "local:1", {
      activeStart: "08:00",
      activeEnd: "20:00",
      glassSize: 250,
    })
    setHydrationConfig(db, "local:1", { glassSize: 300 })

    expect(hydrationKeysInDb(db, "local:1")).toHaveLength(3)
    const rows = db
      .prepare("SELECT key, value FROM user_settings WHERE user_uid = ? ORDER BY key")
      .all("local:1") as { key: string; value: string }[]
    expect(rows).toEqual([
      { key: HYDRATION_KEY_ACTIVE_END, value: "20:00" },
      { key: HYDRATION_KEY_ACTIVE_START, value: "08:00" },
      { key: HYDRATION_KEY_GLASS_SIZE, value: "300" },
    ])
  })

  it("seeds defaults for all keys on first partial save", () => {
    const config = setHydrationConfig(db, "local:1", { glassSize: 400 })

    expect(config).toEqual({
      activeStart: DEFAULT_ACTIVE_START,
      activeEnd: DEFAULT_ACTIVE_END,
      glassSize: 400,
    })
    expect(hydrationKeysInDb(db, "local:1")).toHaveLength(3)
  })
})

describe("validateHydrationConfigPartial", () => {
  it("rejects invalid HH:MM", () => {
    const result = validateHydrationConfigPartial({ activeStart: "25:00" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("active_start")
  })

  it("rejects active_start >= active_end", () => {
    const result = validateHydrationConfigPartial({
      activeStart: "21:00",
      activeEnd: "07:00",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("before")
  })

  it("rejects equal start and end", () => {
    const result = validateHydrationConfigPartial({
      activeStart: "09:00",
      activeEnd: "09:00",
    })
    expect(result.ok).toBe(false)
  })

  it("rejects non-positive glass_size", () => {
    const result = validateHydrationConfigPartial({ glassSize: 0 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("glass_size")
  })

  it("validates partial patch against existing window", () => {
    const existing = { activeStart: "07:00", activeEnd: "21:00", glassSize: 250 }
    const bad = validateHydrationConfigPartial({ activeEnd: "06:00" }, existing)
    expect(bad.ok).toBe(false)

    const good = validateHydrationConfigPartial({ activeStart: "08:00" }, existing)
    expect(good.ok).toBe(true)
    if (good.ok) expect(good.normalised.activeStart).toBe("08:00")
  })

  it("normalises valid times on success", () => {
    const result = validateHydrationConfigPartial({
      activeStart: "7:30",
      activeEnd: "22:00",
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.normalised.activeStart).toBe("07:30")
      expect(result.normalised.activeEnd).toBe("22:00")
    }
  })
})

describe("isHydrationMutedForLocalDay", () => {
  it("is true when muted_until equals local today", () => {
    expect(isHydrationMutedForLocalDay("2026-06-23", "2026-06-23")).toBe(true)
  })

  it("is false after local day boundary", () => {
    expect(isHydrationMutedForLocalDay("2026-06-23", "2026-06-24")).toBe(false)
  })

  it("is false when mute is unset", () => {
    expect(isHydrationMutedForLocalDay(null, "2026-06-23")).toBe(false)
  })
})

describe("setHydrationMutedForLocalDay", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db?.close()
  })

  it("persists hydration.muted_until for the user", () => {
    setHydrationMutedForLocalDay(db, "local:1", "2026-06-23")
    const row = db
      .prepare("SELECT value FROM user_settings WHERE user_uid = ? AND key = ?")
      .get("local:1", HYDRATION_KEY_MUTED_UNTIL) as { value: string }
    expect(row.value).toBe("2026-06-23")
  })
})
