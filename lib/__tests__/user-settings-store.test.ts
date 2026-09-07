import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { writeUserSetting } from "@/lib/settings/user-settings-store"

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

function auditRows(db: Database.Database) {
  return db
    .prepare("SELECT user_email, action, entity_type, details FROM audit_log ORDER BY id")
    .all() as { user_email: string | null; action: string; entity_type: string; details: string }[]
}

describe("writeUserSetting", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db?.close()
  })

  it("audits write with key and old/new values by default", () => {
    writeUserSetting(db, {
      userUid: "local:1",
      key: "hydration.glass_size",
      value: "250",
      actorEmail: "user@test.com",
    })
    writeUserSetting(db, {
      userUid: "local:1",
      key: "hydration.glass_size",
      value: "300",
      actorEmail: "user@test.com",
    })

    const rows = auditRows(db)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      user_email: "user@test.com",
      action: "UPDATE",
      entity_type: "user_settings",
    })
    expect(JSON.parse(rows[0].details)).toEqual({
      user_uid: "local:1",
      key: "hydration.glass_size",
      old_value: null,
      new_value: "250",
    })
    expect(JSON.parse(rows[1].details)).toEqual({
      user_uid: "local:1",
      key: "hydration.glass_size",
      old_value: "250",
      new_value: "300",
    })
  })

  it("does not audit when audit: false (bookkeeping)", () => {
    writeUserSetting(db, {
      userUid: "local:1",
      key: "hydration.last_nudge_at",
      value: "1710000000000",
      actorEmail: "cron@system",
      audit: false,
    })
    expect(auditRows(db)).toHaveLength(0)
    const row = db
      .prepare("SELECT value FROM user_settings WHERE user_uid = ? AND key = ?")
      .get("local:1", "hydration.last_nudge_at") as { value: string }
    expect(row.value).toBe("1710000000000")
  })

  it("audits delete with removed: true", () => {
    writeUserSetting(db, {
      userUid: "local:1",
      key: "locale.timezone",
      value: "Australia/Sydney",
      actorEmail: "user@test.com",
    })
    writeUserSetting(db, {
      userUid: "local:1",
      key: "locale.timezone",
      value: null,
      actorEmail: "user@test.com",
    })

    const rows = auditRows(db)
    expect(rows).toHaveLength(2)
    expect(JSON.parse(rows[1].details)).toEqual({
      user_uid: "local:1",
      key: "locale.timezone",
      old_value: "Australia/Sydney",
      new_value: null,
      removed: true,
    })
    const remaining = db
      .prepare("SELECT 1 FROM user_settings WHERE user_uid = ? AND key = ?")
      .get("local:1", "locale.timezone")
    expect(remaining).toBeUndefined()
  })

  it("skips audit when value is unchanged", () => {
    writeUserSetting(db, {
      userUid: "local:1",
      key: "hydration.glass_size",
      value: "250",
      actorEmail: "user@test.com",
    })
    writeUserSetting(db, {
      userUid: "local:1",
      key: "hydration.glass_size",
      value: "250",
      actorEmail: "user@test.com",
    })
    expect(auditRows(db)).toHaveLength(1)
  })
})
