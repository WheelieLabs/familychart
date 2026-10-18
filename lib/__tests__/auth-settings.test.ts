import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  isEntraAuthEnabled,
  isEntraProviderActive,
  resolveEntraCredentials,
} from "@/lib/settings/auth-settings"
import { SETTING_AUTH_ENTRA_ENABLED } from "@/lib/settings/registry"

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

function insertSetting(db: Database.Database, key: string, value: string, updatedAt: number) {
  db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
    key,
    value,
    updatedAt,
  )
}

describe("Entra auth settings", () => {
  let db: Database.Database
  const originalEntraEnabled = process.env.FC_AUTH_ENTRA_ENABLED
  const originalEntraId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID
  const originalEntraSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET
  const originalEntraTenant = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID

  beforeEach(() => {
    db = createTestDb()
    delete process.env.FC_AUTH_ENTRA_ENABLED
    delete process.env.AUTH_MICROSOFT_ENTRA_ID_ID
    delete process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET
    delete process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID
  })

  afterEach(() => {
    if (originalEntraEnabled === undefined) delete process.env.FC_AUTH_ENTRA_ENABLED
    else process.env.FC_AUTH_ENTRA_ENABLED = originalEntraEnabled
    if (originalEntraId === undefined) delete process.env.AUTH_MICROSOFT_ENTRA_ID_ID
    else process.env.AUTH_MICROSOFT_ENTRA_ID_ID = originalEntraId
    if (originalEntraSecret === undefined) delete process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET
    else process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = originalEntraSecret
    if (originalEntraTenant === undefined) delete process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID
    else process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID = originalEntraTenant
    db?.close()
  })

  it("stays disabled and does not write a row when enablement is unset", () => {
    expect(isEntraAuthEnabled(db)).toBe(false)
    const row = db
      .prepare("SELECT value FROM app_settings WHERE key = ?")
      .get(SETTING_AUTH_ENTRA_ENABLED)
    expect(row).toBeUndefined()
  })

  it("stays enabled from the database row when no enablement environment variable is set", () => {
    const now = Date.now()
    insertSetting(db, SETTING_AUTH_ENTRA_ENABLED, "true", now)
    insertSetting(db, "auth.entra.client_id", "db-client-id", now)
    insertSetting(db, "auth.entra.tenant_id", "db-tenant-id", now)
    insertSetting(db, "auth.entra.client_secret", "db-secret", now)
    expect(isEntraAuthEnabled(db)).toBe(true)
    expect(isEntraProviderActive(db)).toBe(true)
    expect(resolveEntraCredentials(db)).toEqual({
      clientId: "db-client-id",
      clientSecret: "db-secret",
      tenantId: "db-tenant-id",
    })
  })

  it("keeps a stored false when no enablement environment variable is set", () => {
    insertSetting(db, SETTING_AUTH_ENTRA_ENABLED, "false", Date.now())
    expect(isEntraAuthEnabled(db)).toBe(false)
  })

  it("is inactive when the database enables Entra but credentials are missing", () => {
    insertSetting(db, SETTING_AUTH_ENTRA_ENABLED, "true", Date.now())
    expect(isEntraProviderActive(db)).toBe(false)
    expect(resolveEntraCredentials(db)).toBeNull()
  })

  it("is active when both enablement and credentials come from the environment", () => {
    process.env.FC_AUTH_ENTRA_ENABLED = "true"
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "client-id"
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = "client-secret"
    process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID = "tenant-id"
    expect(isEntraProviderActive(db)).toBe(true)
    expect(resolveEntraCredentials(db)).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
      tenantId: "tenant-id",
    })
  })

  it("lets environment credentials win over database values for the same key", () => {
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "env-client-id"
    const now = Date.now()
    insertSetting(db, SETTING_AUTH_ENTRA_ENABLED, "true", now)
    insertSetting(db, "auth.entra.client_id", "db-client-id", now)
    insertSetting(db, "auth.entra.tenant_id", "db-tenant-id", now)
    insertSetting(db, "auth.entra.client_secret", "db-secret", now)
    expect(resolveEntraCredentials(db)).toEqual({
      clientId: "env-client-id",
      clientSecret: "db-secret",
      tenantId: "db-tenant-id",
    })
  })

  it("resolves credentials without treating a disabled provider as active", () => {
    const now = Date.now()
    insertSetting(db, "auth.entra.client_id", "db-client-id", now)
    insertSetting(db, "auth.entra.tenant_id", "db-tenant-id", now)
    insertSetting(db, "auth.entra.client_secret", "db-secret", now)
    expect(resolveEntraCredentials(db)).toEqual({
      clientId: "db-client-id",
      clientSecret: "db-secret",
      tenantId: "db-tenant-id",
    })
    expect(isEntraAuthEnabled(db)).toBe(false)
    expect(isEntraProviderActive(db)).toBe(false)
  })
})
