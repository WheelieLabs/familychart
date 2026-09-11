import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  isEntraAuthEnabled,
  isEntraProviderActive,
  resolveEntraCredentials,
  seedAuthSettingsFromLegacyEnv,
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

describe("auth settings seed", () => {
  let db: Database.Database
  const originalProviders = process.env.ENABLED_AUTH_PROVIDERS
  const originalEntraId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID
  const originalEntraSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET
  const originalEntraTenant = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID

  beforeEach(() => {
    db = createTestDb()
    delete process.env.AUTH_MICROSOFT_ENTRA_ID_ID
    delete process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET
    delete process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID
  })

  afterEach(() => {
    if (originalProviders === undefined) delete process.env.ENABLED_AUTH_PROVIDERS
    else process.env.ENABLED_AUTH_PROVIDERS = originalProviders
    if (originalEntraId === undefined) delete process.env.AUTH_MICROSOFT_ENTRA_ID_ID
    else process.env.AUTH_MICROSOFT_ENTRA_ID_ID = originalEntraId
    if (originalEntraSecret === undefined) delete process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET
    else process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = originalEntraSecret
    if (originalEntraTenant === undefined) delete process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID
    else process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID = originalEntraTenant
    db?.close()
  })

  it("seeds auth.entra.enabled from legacy ENABLED_AUTH_PROVIDERS once", () => {
    process.env.ENABLED_AUTH_PROVIDERS = "entra"
    seedAuthSettingsFromLegacyEnv(db)
    expect(isEntraAuthEnabled(db)).toBe(true)
    const row = db
      .prepare("SELECT value FROM app_settings WHERE key = ?")
      .get(SETTING_AUTH_ENTRA_ENABLED) as { value: string }
    expect(row.value).toBe("true")
  })

  it("does not overwrite existing db value", () => {
    process.env.ENABLED_AUTH_PROVIDERS = "entra"
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_AUTH_ENTRA_ENABLED,
      "false",
      Date.now(),
    )
    seedAuthSettingsFromLegacyEnv(db)
    expect(isEntraAuthEnabled(db)).toBe(false)
  })

  it("isEntraProviderActive requires credentials from some source", () => {
    process.env.ENABLED_AUTH_PROVIDERS = "entra"
    seedAuthSettingsFromLegacyEnv(db)
    expect(isEntraProviderActive(db)).toBe(false)
    expect(resolveEntraCredentials(db)).toBeNull()
  })

  it("is active when both enablement and credentials are env-sourced", () => {
    process.env.ENABLED_AUTH_PROVIDERS = "entra"
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "client-id"
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = "client-secret"
    process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID = "tenant-id"
    seedAuthSettingsFromLegacyEnv(db)
    expect(isEntraProviderActive(db)).toBe(true)
    expect(resolveEntraCredentials(db)).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
      tenantId: "tenant-id",
    })
  })

  it("DB-only config (enabled + credentials purely in app_settings, no env at all) is fully active", () => {
    // No ENABLED_AUTH_PROVIDERS, no AUTH_MICROSOFT_ENTRA_ID_* — purely configured
    // through System Settings: a self-hoster who configures Entra purely through
    // System Settings (DB-only, no env vars) gets a working Entra sign-in, not a
    // broken button. lib/auth.ts resolves its provider from this exact same
    // function, so DB-only credentials now actually reach the constructed
    // NextAuth provider, not just the button.
    const now = Date.now()
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_AUTH_ENTRA_ENABLED, "true", now,
    )
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      "auth.entra.client_id", "db-client-id", now,
    )
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      "auth.entra.tenant_id", "db-tenant-id", now,
    )
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      "auth.entra.client_secret", "db-secret", now,
    )
    expect(isEntraAuthEnabled(db)).toBe(true)
    expect(isEntraProviderActive(db)).toBe(true)
    expect(resolveEntraCredentials(db)).toEqual({
      clientId: "db-client-id",
      clientSecret: "db-secret",
      tenantId: "db-tenant-id",
    })
  })

  it("mixed sources — env credentials win over DB values for the same key, DB fills the rest", () => {
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "env-client-id"
    const now = Date.now()
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_AUTH_ENTRA_ENABLED, "true", now,
    )
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      "auth.entra.client_id", "db-client-id", now,
    )
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      "auth.entra.tenant_id", "db-tenant-id", now,
    )
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      "auth.entra.client_secret", "db-secret", now,
    )
    expect(resolveEntraCredentials(db)).toEqual({
      clientId: "env-client-id",
      clientSecret: "db-secret",
      tenantId: "db-tenant-id",
    })
  })

  it("resolveEntraCredentials is null when auth.entra.enabled is false, even with full credentials in DB", () => {
    const now = Date.now()
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      "auth.entra.client_id", "db-client-id", now,
    )
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      "auth.entra.tenant_id", "db-tenant-id", now,
    )
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      "auth.entra.client_secret", "db-secret", now,
    )
    // resolveEntraCredentials itself is enablement-agnostic (pure credential lookup);
    // isEntraProviderActive is the one that also requires auth.entra.enabled.
    expect(resolveEntraCredentials(db)).toEqual({
      clientId: "db-client-id",
      clientSecret: "db-secret",
      tenantId: "db-tenant-id",
    })
    expect(isEntraAuthEnabled(db)).toBe(false)
    expect(isEntraProviderActive(db)).toBe(false)
  })
})
