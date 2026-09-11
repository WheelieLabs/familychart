import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  SETTING_PUSH_VAPID_PRIVATE_KEY,
  SETTING_PUSH_VAPID_PUBLIC_KEY,
  SETTING_PUSH_VAPID_SUBJECT,
} from "@/lib/settings/registry"
import {
  ensureVapidKeysGenerated,
  getVapidConfig,
  seedVapidSubjectFromEmail,
} from "@/lib/vapid-config"

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

describe("vapid-config", () => {
  let db: Database.Database
  const originalProfile = process.env.FC_PLATFORM_PROFILE
  const originalPub = process.env.VAPID_PUBLIC_KEY
  const originalPriv = process.env.VAPID_PRIVATE_KEY
  const originalSub = process.env.VAPID_SUBJECT

  beforeEach(() => {
    db = createTestDb()
    delete process.env.FC_PLATFORM_PROFILE
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
    delete process.env.VAPID_SUBJECT
  })

  afterEach(() => {
    if (originalProfile === undefined) delete process.env.FC_PLATFORM_PROFILE
    else process.env.FC_PLATFORM_PROFILE = originalProfile
    if (originalPub === undefined) delete process.env.VAPID_PUBLIC_KEY
    else process.env.VAPID_PUBLIC_KEY = originalPub
    if (originalPriv === undefined) delete process.env.VAPID_PRIVATE_KEY
    else process.env.VAPID_PRIVATE_KEY = originalPriv
    if (originalSub === undefined) delete process.env.VAPID_SUBJECT
    else process.env.VAPID_SUBJECT = originalSub
    db?.close()
  })

  it("auto-generates keys into app_settings on self-host", () => {
    ensureVapidKeysGenerated(db)
    seedVapidSubjectFromEmail(db, "admin@example.com")
    const cfg = getVapidConfig(db)
    expect(cfg).not.toBeNull()
    expect(cfg!.subject).toBe("mailto:admin@example.com")
    const pub = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(
      SETTING_PUSH_VAPID_PUBLIC_KEY,
    ) as { value: string }
    expect(pub.value.length).toBeGreaterThan(10)
  })

  it("does not auto-generate on managed profile", () => {
    process.env.FC_PLATFORM_PROFILE = "managed"
    ensureVapidKeysGenerated(db)
    const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(
      SETTING_PUSH_VAPID_PUBLIC_KEY,
    )
    expect(row).toBeUndefined()
  })

  it("env wins over db", () => {
    process.env.VAPID_PUBLIC_KEY = "env-pub-key-value-here-xx"
    process.env.VAPID_PRIVATE_KEY = "env-priv-key-value-here-xx"
    process.env.VAPID_SUBJECT = "mailto:env@example.com"
    ensureVapidKeysGenerated(db)
    const cfg = getVapidConfig(db)
    expect(cfg?.publicKey).toBe("env-pub-key-value-here-xx")
    expect(cfg?.subject).toBe("mailto:env@example.com")
  })
})
