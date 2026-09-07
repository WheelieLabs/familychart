import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// setup-gate.ts imports next-auth transitively via @/lib/auth-helpers for
// localUserNeedsMfaEnrollment(); this suite doesn't touch it, so stub it out
// to avoid pulling next-auth into the unit-test environment (same pattern as
// setup-gate.test.ts).
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))

import { createFirstAdmin, isBootstrapEndpointAllowed } from "@/lib/setup-bootstrap"
import { markAdminSeen, setSetupComplete } from "@/lib/setup-gate"

describe("isBootstrapEndpointAllowed", () => {
  const originalProfile = process.env.FC_PLATFORM_PROFILE
  const originalProviders = process.env.ENABLED_AUTH_PROVIDERS

  afterEach(() => {
    if (originalProfile === undefined) delete process.env.FC_PLATFORM_PROFILE
    else process.env.FC_PLATFORM_PROFILE = originalProfile
    if (originalProviders === undefined) delete process.env.ENABLED_AUTH_PROVIDERS
    else process.env.ENABLED_AUTH_PROVIDERS = originalProviders
  })

  it("allows credentials-only self-host by default", () => {
    delete process.env.FC_PLATFORM_PROFILE
    delete process.env.ENABLED_AUTH_PROVIDERS
    expect(isBootstrapEndpointAllowed()).toBe(true)
  })

  it("refuses managed profile", () => {
    process.env.FC_PLATFORM_PROFILE = "managed"
    expect(isBootstrapEndpointAllowed()).toBe(false)
  })

  it("allows entra-only self-host (local auth always on)", () => {
    process.env.ENABLED_AUTH_PROVIDERS = "entra"
    expect(isBootstrapEndpointAllowed()).toBe(true)
  })
})

describe("createFirstAdmin", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
    db.exec(`
      CREATE TABLE system_config (
        key TEXT UNIQUE NOT NULL,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        password_hash TEXT,
        role TEXT NOT NULL,
        can_report INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        auth_method TEXT NOT NULL DEFAULT 'local',
        external_id TEXT
      );
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `)
  })

  afterEach(() => {
    db.close()
  })

  it("creates the first admin on a fresh instance, then refuses a second", () => {
    expect(createFirstAdmin(db, "admin@example.com", "hash").status).toBe(201)
    const count = db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }
    expect(count.n).toBe(1)
    // Window is closed once a local account exists.
    expect(createFirstAdmin(db, "other@example.com", "hash")).toMatchObject({ status: 403 })
    expect((db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n).toBe(1)
  })

  it("refuses once an admin has been seen (Entra-primary instance, no local admin)", () => {
    markAdminSeen(db)
    expect(createFirstAdmin(db, "attacker@example.com", "hash")).toMatchObject({ status: 403 })
    expect((db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n).toBe(0)
  })

  it("refuses once setup is complete", () => {
    setSetupComplete(db, "admin@example.com")
    expect(createFirstAdmin(db, "attacker@example.com", "hash")).toMatchObject({ status: 403 })
  })

  it("rejects a case-varied duplicate of an existing Entra bookkeeping row's email", () => {
    // lib/account-entra-match.ts always lowercases the email it stores; an operator typing
    // the admin email with different casing must still be caught, not create a second row.
    db.prepare(
      "INSERT INTO accounts (email, role, auth_method, external_id) VALUES ('admin@example.com', 'read', 'entra', 'oid-1')",
    ).run()
    expect(createFirstAdmin(db, "Admin@Example.com", "hash")).toMatchObject({ status: 409 })
    expect((db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n).toBe(1)
  })

  it("still succeeds when only an Entra auto-create bookkeeping row exists (no admin yet)", () => {
    // lib/account-entra-match.ts auto-creates an accounts row for any Entra sign-in, admin
    // or not — this must not be mistaken for "a local account already exists" and lock out
    // the self-host bootstrap window before a real admin has ever been created.
    db.prepare(
      "INSERT INTO accounts (email, role, auth_method, external_id) VALUES ('someone@example.com', 'read', 'entra', 'oid-1')",
    ).run()
    expect(createFirstAdmin(db, "admin@example.com", "hash").status).toBe(201)
    const count = db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }
    expect(count.n).toBe(2)
  })
})
