import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { upsertAppSetting } from "@/lib/settings/app-settings-store"
import {
  SETTING_AUTH_ENTRA_CLIENT_ID,
  SETTING_AUTH_ENTRA_CLIENT_SECRET,
  SETTING_AUTH_ENTRA_ENABLED,
  SETTING_LOCALE_DEFAULT_TIMEZONE,
  SETTING_LOCALE_MEASUREMENT_SYSTEM,
  SETTING_SECURITY_MFA_REQUIRED,
  SETTING_SECURITY_PASSWORD_MIN_LENGTH,
} from "@/lib/settings/registry"
import {
  resolveAllAppSettingsForAdmin,
  resolveSetting,
  resolveSettingForAdmin,
  validateRegistryEnvAtBoot,
} from "@/lib/settings/resolver"

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

describe("resolveSetting precedence", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    delete process.env[ENV_KEY]
  })

  afterEach(() => {
    delete process.env[ENV_KEY]
    db?.close()
  })

  it("returns env-only with locked true", () => {
    process.env[ENV_KEY] = "Europe/London"
    expect(resolveSetting(db, SETTING_LOCALE_DEFAULT_TIMEZONE)).toEqual({
      key: SETTING_LOCALE_DEFAULT_TIMEZONE,
      value: "Europe/London",
      source: "env",
      locked: true,
    })
  })

  it("returns db-only when env is unset", () => {
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_LOCALE_DEFAULT_TIMEZONE,
      "Australia/Sydney",
      Date.now(),
    )
    expect(resolveSetting(db, SETTING_LOCALE_DEFAULT_TIMEZONE)).toEqual({
      key: SETTING_LOCALE_DEFAULT_TIMEZONE,
      value: "Australia/Sydney",
      source: "db",
      locked: false,
    })
  })

  it("returns default when neither env nor db is set", () => {
    expect(resolveSetting(db, SETTING_LOCALE_DEFAULT_TIMEZONE)).toEqual({
      key: SETTING_LOCALE_DEFAULT_TIMEZONE,
      value: "",
      source: "default",
      locked: false,
    })
  })

  it("returns metric default for locale.measurement_system", () => {
    expect(resolveSetting(db, SETTING_LOCALE_MEASUREMENT_SYSTEM)).toEqual({
      key: SETTING_LOCALE_MEASUREMENT_SYSTEM,
      value: "metric",
      source: "default",
      locked: false,
    })
  })

  it("rejects invalid measurement system values", () => {
    const result = upsertAppSetting(db, SETTING_LOCALE_MEASUREMENT_SYSTEM, "us", "admin@test.com")
    expect(result).toEqual({ ok: false, status: 400, error: "Invalid measurement system" })
  })

  it("stores imperial measurement system", () => {
    const result = upsertAppSetting(db, SETTING_LOCALE_MEASUREMENT_SYSTEM, "imperial", "admin@test.com")
    expect(result.ok).toBe(true)
    expect(resolveSetting(db, SETTING_LOCALE_MEASUREMENT_SYSTEM)).toEqual({
      key: SETTING_LOCALE_MEASUREMENT_SYSTEM,
      value: "imperial",
      source: "db",
      locked: false,
    })
  })

  it("prefers env over db when both are set", () => {
    process.env[ENV_KEY] = "Europe/London"
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_LOCALE_DEFAULT_TIMEZONE,
      "Australia/Sydney",
      Date.now(),
    )
    expect(resolveSetting(db, SETTING_LOCALE_DEFAULT_TIMEZONE)).toEqual({
      key: SETTING_LOCALE_DEFAULT_TIMEZONE,
      value: "Europe/London",
      source: "env",
      locked: true,
    })
  })

  it("treats blank env as unset", () => {
    process.env[ENV_KEY] = "   "
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_LOCALE_DEFAULT_TIMEZONE,
      "Australia/Sydney",
      Date.now(),
    )
    expect(resolveSetting(db, SETTING_LOCALE_DEFAULT_TIMEZONE).source).toBe("db")
    expect(resolveSetting(db, SETTING_LOCALE_DEFAULT_TIMEZONE).locked).toBe(false)
  })
})

describe("group env-lock", () => {
  let db: Database.Database
  const originalClientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    if (originalClientId === undefined) delete process.env.AUTH_MICROSOFT_ENTRA_ID_ID
    else process.env.AUTH_MICROSOFT_ENTRA_ID_ID = originalClientId
    db?.close()
  })

  it("locks sibling group entries when any Entra env var is set", () => {
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "client-id"
    const enabled = resolveSetting(db, SETTING_AUTH_ENTRA_ENABLED)
    expect(enabled.locked).toBe(true)
    expect(enabled.source).toBe("default")
  })
})

describe("secret admin API", () => {
  let db: Database.Database
  const originalSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET
  const originalClientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID
  const originalTenant = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID

  beforeEach(() => {
    db = createTestDb()
    delete process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET
    delete process.env.AUTH_MICROSOFT_ENTRA_ID_ID
    delete process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID
  })

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET
    else process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = originalSecret
    if (originalClientId === undefined) delete process.env.AUTH_MICROSOFT_ENTRA_ID_ID
    else process.env.AUTH_MICROSOFT_ENTRA_ID_ID = originalClientId
    if (originalTenant === undefined) delete process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID
    else process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID = originalTenant
    db?.close()
  })

  it("never returns secret plaintext via admin resolver", () => {
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = "super-secret"
    const admin = resolveSettingForAdmin(db, SETTING_AUTH_ENTRA_CLIENT_SECRET)
    expect(admin?.value).toBe("")
    expect(admin?.secretSet).toBe(true)
    expect(admin?.locked).toBe(true)

    const internal = resolveSetting(db, SETTING_AUTH_ENTRA_CLIENT_SECRET)
    expect(internal.value).toBe("super-secret")
  })

  it("audits secret writes without values", () => {
    const result = upsertAppSetting(db, SETTING_AUTH_ENTRA_CLIENT_SECRET, "new-secret", "admin@test.com")
    expect(result.ok).toBe(true)
    const audit = db
      .prepare("SELECT details FROM audit_log ORDER BY id DESC LIMIT 1")
      .get() as { details: string }
    expect(JSON.parse(audit.details)).toEqual({ key: SETTING_AUTH_ENTRA_CLIENT_SECRET, changed: true })
  })
})

describe("platformLocked under managed", () => {
  let db: Database.Database
  const originalProfile = process.env.FC_PLATFORM_PROFILE

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    if (originalProfile === undefined) delete process.env.FC_PLATFORM_PROFILE
    else process.env.FC_PLATFORM_PROFILE = originalProfile
    db?.close()
  })

  it("omits platformLocked settings from admin list on managed profile", () => {
    process.env.FC_PLATFORM_PROFILE = "managed"
    const keys = resolveAllAppSettingsForAdmin(db).map(r => r.key)
    expect(keys).not.toContain(SETTING_SECURITY_MFA_REQUIRED)
  })

  it("rejects writes to platformLocked keys under managed profile", () => {
    process.env.FC_PLATFORM_PROFILE = "managed"
    const result = upsertAppSetting(db, SETTING_SECURITY_MFA_REQUIRED, "false", "admin@test.com")
    expect(result).toEqual({ ok: false, status: 403, error: "Managed by platform" })

    const row = db
      .prepare("SELECT value FROM app_settings WHERE key = ?")
      .get(SETTING_SECURITY_MFA_REQUIRED) as { value: string } | undefined
    expect(row).toBeUndefined()

    const auditCount = db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }
    expect(auditCount.n).toBe(0)
  })

  it("allows platformLocked writes on self-host", () => {
    delete process.env.FC_PLATFORM_PROFILE
    const result = upsertAppSetting(db, SETTING_SECURITY_MFA_REQUIRED, "true", "admin@test.com")
    expect(result.ok).toBe(true)
  })
})

describe("validateRegistryEnvAtBoot", () => {
  afterEach(() => {
    delete process.env[ENV_KEY]
  })

  it("throws on invalid env timezone", () => {
    process.env[ENV_KEY] = "Not/A/Zone"
    expect(() => validateRegistryEnvAtBoot()).toThrow(/Invalid FC_DEFAULT_TIMEZONE/)
  })

  it("accepts valid env timezone", () => {
    process.env[ENV_KEY] = "Europe/London"
    expect(() => validateRegistryEnvAtBoot()).not.toThrow()
  })
})

describe("upsertAppSetting", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    delete process.env[ENV_KEY]
  })

  afterEach(() => {
    delete process.env[ENV_KEY]
    db?.close()
  })

  it("rejects invalid timezone via registry validation", () => {
    const result = upsertAppSetting(db, SETTING_LOCALE_DEFAULT_TIMEZONE, "Not/A/Zone", "admin@test.com")
    expect(result).toEqual({ ok: false, status: 400, error: "Invalid timezone" })
  })

  it("rejects writes when env-managed", () => {
    process.env[ENV_KEY] = "Europe/London"
    const result = upsertAppSetting(db, SETTING_LOCALE_DEFAULT_TIMEZONE, "Australia/Sydney", "admin@test.com")
    expect(result).toEqual({ ok: false, status: 409, error: "Managed via environment" })
  })

  it("writes db value and emits audit entry", () => {
    const result = upsertAppSetting(db, SETTING_LOCALE_DEFAULT_TIMEZONE, "Australia/Sydney", "admin@test.com")
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.resolved).toMatchObject({
      key: SETTING_LOCALE_DEFAULT_TIMEZONE,
      value: "Australia/Sydney",
      source: "db",
      locked: false,
      secret: false,
      secretSet: false,
    })

    const audit = db
      .prepare("SELECT action, entity_type, details FROM audit_log ORDER BY id DESC LIMIT 1")
      .get() as { action: string; entity_type: string; details: string }
    expect(audit.action).toBe("UPDATE")
    expect(audit.entity_type).toBe("app_settings")
    expect(JSON.parse(audit.details)).toEqual({
      key: SETTING_LOCALE_DEFAULT_TIMEZONE,
      old_value: null,
      new_value: "Australia/Sydney",
    })
  })

  it("records old_value on update", () => {
    upsertAppSetting(db, SETTING_LOCALE_DEFAULT_TIMEZONE, "Europe/London", "admin@test.com")
    upsertAppSetting(db, SETTING_LOCALE_DEFAULT_TIMEZONE, "Australia/Sydney", "admin@test.com")

    const audit = db
      .prepare("SELECT details FROM audit_log ORDER BY id DESC LIMIT 1")
      .get() as { details: string }
    expect(JSON.parse(audit.details)).toEqual({
      key: SETTING_LOCALE_DEFAULT_TIMEZONE,
      old_value: "Europe/London",
      new_value: "Australia/Sydney",
    })
  })
})

describe("security.password_min_length", () => {
  let db: Database.Database
  const originalEnv = process.env.FC_PASSWORD_MIN_LENGTH

  beforeEach(() => {
    db = createTestDb()
    delete process.env.FC_PASSWORD_MIN_LENGTH
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.FC_PASSWORD_MIN_LENGTH
    else process.env.FC_PASSWORD_MIN_LENGTH = originalEnv
    db.close()
  })

  it("defaults to 10 when unset (unchanged from pre-wiring hardcoded behaviour)", () => {
    expect(resolveSetting(db, SETTING_SECURITY_PASSWORD_MIN_LENGTH)).toEqual({
      key: SETTING_SECURITY_PASSWORD_MIN_LENGTH,
      value: "10",
      source: "default",
      locked: false,
    })
  })

  it("honours a DB-stored override", () => {
    upsertAppSetting(db, SETTING_SECURITY_PASSWORD_MIN_LENGTH, "14", "admin@test.com")
    expect(resolveSetting(db, SETTING_SECURITY_PASSWORD_MIN_LENGTH).value).toBe("14")
  })

  it("honours an env override, locked", () => {
    process.env.FC_PASSWORD_MIN_LENGTH = "16"
    const resolved = resolveSetting(db, SETTING_SECURITY_PASSWORD_MIN_LENGTH)
    expect(resolved.value).toBe("16")
    expect(resolved.source).toBe("env")
    expect(resolved.locked).toBe(true)
  })
})
