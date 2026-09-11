import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// setup-gate.ts imports next-auth transitively via @/lib/auth-helpers for
// localUserNeedsMfaEnrollment(); this suite doesn't touch it, so stub it out
// to avoid pulling next-auth into the unit-test environment (same pattern as
// auth-helpers-mfa-policy.test.ts).
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))

import {
  getSetupWizardContext,
  isStage1AdminReady,
  markAdminSeen,
  type SetupSessionInfo,
} from "@/lib/setup-gate"

const baseSession: Pick<SetupSessionInfo, "localUserId" | "email"> = {
  localUserId: null,
  email: null,
}

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
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
      totp_secret TEXT,
      auth_method TEXT NOT NULL DEFAULT 'local',
      external_id TEXT
    );
    CREATE TABLE app_settings (
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (key)
    );
    CREATE TABLE people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `)
  return db
}

describe("setup-gate", () => {
  let db: Database.Database
  const originalProfile = process.env.FC_PLATFORM_PROFILE

  beforeEach(() => {
    db = createTestDb()
    delete process.env.FC_PLATFORM_PROFILE
  })

  afterEach(() => {
    if (originalProfile === undefined) delete process.env.FC_PLATFORM_PROFILE
    else process.env.FC_PLATFORM_PROFILE = originalProfile
    db?.close()
  })

  it("managed mode exposes person and timezone steps", () => {
    process.env.FC_PLATFORM_PROFILE = "managed"
    db.prepare(
      "INSERT INTO accounts (email, password_hash, role, can_report) VALUES (?, ?, 'admin', 0)",
    ).run("a@x.com", "hash")
    const ctx = getSetupWizardContext(db, {
      ...baseSession,
      authenticated: true,
      isAdmin: true,
      entraSession: false,
    })
    expect(ctx.mode).toBe("managed")
    expect(ctx.steps).toEqual(["person", "timezone"])
    expect(ctx.displaySteps).toEqual(["person", "timezone"])
    expect(ctx.initialStep).toBe("person")
    expect(ctx.bootstrapAllowed).toBe(false)
  })

  it("managed mode skips person step when a person already exists", () => {
    process.env.FC_PLATFORM_PROFILE = "managed"
    db.prepare(
      "INSERT INTO accounts (email, password_hash, role, can_report) VALUES (?, ?, 'admin', 0)",
    ).run("a@x.com", "hash")
    db.prepare(
      "INSERT INTO people (name, color, sort_order) VALUES ('Alex', '#2B7DC2', 0)",
    ).run()
    const ctx = getSetupWizardContext(db, {
      ...baseSession,
      authenticated: true,
      isAdmin: true,
      entraSession: false,
    })
    expect(ctx.initialStep).toBe("timezone")
  })

  it("self-host bootstrap shows full display sequence before stage1", () => {
    const ctx = getSetupWizardContext(db, {
      ...baseSession,
      authenticated: false,
      isAdmin: false,
      entraSession: false,
    })
    expect(ctx.steps).toEqual(["account"])
    expect(ctx.displaySteps).toEqual(["account", "person", "timezone", "smtp"])
  })

  it("SSO finish display omits account step", () => {
    markAdminSeen(db)
    const ctx = getSetupWizardContext(db, {
      ...baseSession,
      authenticated: true,
      isAdmin: true,
      entraSession: true,
    })
    expect(ctx.ssoFinishEligible).toBe(true)
    expect(ctx.displaySteps).toEqual(["person", "timezone", "smtp"])
    expect(ctx.steps[0]).not.toBe("account")
    expect(ctx.initialStep).toBe("person")
  })

  it("stage1 ready when admin_seen without local users", () => {
    markAdminSeen(db)
    expect(isStage1AdminReady(db)).toBe(true)
  })

  it("stage1 NOT ready when only an Entra auto-create bookkeeping row exists (no admin seen)", () => {
    // lib/account-entra-match.ts auto-creates an accounts row for any Entra sign-in,
    // admin or not — this must not be mistaken for "a local admin already exists".
    db.prepare(
      "INSERT INTO accounts (email, role, auth_method, external_id) VALUES ('someone@example.com', 'read', 'entra', 'oid-1')",
    ).run()
    expect(isStage1AdminReady(db)).toBe(false)
  })

  it("managed mode: stage1 NOT ready when an admin-role account is Entra-backed, not local", () => {
    // An admin-role invite claimed via Entra sign-in (lib/account-entra-match.ts) flips
    // auth_method to 'entra' but leaves role='admin' untouched — that must not count as
    // "a local (password-based) admin credential exists" on a managed profile.
    process.env.FC_PLATFORM_PROFILE = "managed"
    db.prepare(
      "INSERT INTO accounts (email, role, auth_method, external_id) VALUES ('admin@example.com', 'admin', 'entra', 'oid-1')",
    ).run()
    expect(isStage1AdminReady(db)).toBe(false)
  })

  it("managed mode inserts an mfa step before person when the admin still needs enrollment", () => {
    process.env.FC_PLATFORM_PROFILE = "managed"
    const { lastInsertRowid } = db
      .prepare(
        "INSERT INTO accounts (email, password_hash, role, can_report) VALUES (?, ?, 'admin', 0)",
      )
      .run("a@x.com", "hash")
    const ctx = getSetupWizardContext(db, {
      authenticated: true,
      isAdmin: true,
      entraSession: false,
      localUserId: Number(lastInsertRowid),
      email: "a@x.com",
    })
    expect(ctx.showMfaStep).toBe(true)
    expect(ctx.steps).toEqual(["mfa", "person", "timezone"])
    expect(ctx.displaySteps).toEqual(["mfa", "person", "timezone"])
    expect(ctx.initialStep).toBe("mfa")
    expect(ctx.currentUserEmail).toBe("a@x.com")
  })

  it("managed mode with no session after stage1 asks for sign-in, not person/timezone", () => {
    process.env.FC_PLATFORM_PROFILE = "managed"
    db.prepare(
      "INSERT INTO accounts (email, password_hash, role, can_report, totp_secret) VALUES (?, ?, 'admin', 0, ?)",
    ).run("a@x.com", "hash", "enrolled-secret")
    const ctx = getSetupWizardContext(db, {
      authenticated: false,
      isAdmin: false,
      entraSession: false,
      localUserId: null,
      email: null,
    })
    expect(ctx.stage1Ready).toBe(true)
    expect(ctx.initialStep).toBe("account")
    expect(ctx.steps).toEqual(["account"])
    expect(ctx.displaySteps[0]).toBe("account")
    expect(ctx.authenticated).toBe(false)
  })

  it("self-host with no session after stage1 asks for sign-in, not timezone", () => {
    markAdminSeen(db)
    db.prepare(
      "INSERT INTO accounts (email, password_hash, role, can_report) VALUES (?, ?, 'admin', 0)",
    ).run("a@x.com", "hash")
    const ctx = getSetupWizardContext(db, {
      authenticated: false,
      isAdmin: false,
      entraSession: false,
      localUserId: null,
      email: null,
    })
    expect(ctx.stage1Ready).toBe(true)
    expect(ctx.initialStep).toBe("account")
    expect(ctx.steps).toEqual(["account"])
  })

  it("managed mode omits the mfa step once the admin has enrolled", () => {
    process.env.FC_PLATFORM_PROFILE = "managed"
    const { lastInsertRowid } = db
      .prepare(
        "INSERT INTO accounts (email, password_hash, role, can_report, totp_secret) VALUES (?, ?, 'admin', 0, ?)",
      )
      .run("a@x.com", "hash", "some-secret")
    const ctx = getSetupWizardContext(db, {
      authenticated: true,
      isAdmin: true,
      entraSession: false,
      localUserId: Number(lastInsertRowid),
      email: "a@x.com",
    })
    expect(ctx.showMfaStep).toBe(false)
    expect(ctx.steps).toEqual(["person", "timezone"])
    expect(ctx.initialStep).toBe("person")
  })

  it("mfa step never shows for an Entra-authenticated session, even on managed", () => {
    process.env.FC_PLATFORM_PROFILE = "managed"
    const { lastInsertRowid } = db
      .prepare(
        "INSERT INTO accounts (email, password_hash, role, can_report) VALUES (?, ?, 'admin', 0)",
      )
      .run("a@x.com", "hash")
    const ctx = getSetupWizardContext(db, {
      authenticated: true,
      isAdmin: true,
      entraSession: true,
      localUserId: Number(lastInsertRowid),
      email: "a@x.com",
    })
    expect(ctx.showMfaStep).toBe(false)
  })

  it("self-host inserts an mfa step before person when the security.mfa_required setting is on", () => {
    markAdminSeen(db)
    db.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES ('security.mfa_required', 'true', 0)",
    ).run()
    const { lastInsertRowid } = db
      .prepare(
        "INSERT INTO accounts (email, password_hash, role, can_report) VALUES (?, ?, 'admin', 0)",
      )
      .run("a@x.com", "hash")
    const ctx = getSetupWizardContext(db, {
      authenticated: true,
      isAdmin: true,
      entraSession: false,
      localUserId: Number(lastInsertRowid),
      email: "a@x.com",
    })
    expect(ctx.steps).toEqual(["mfa", "person", "timezone", "smtp"])
    expect(ctx.initialStep).toBe("mfa")
  })

  it("self-host omits the mfa step when security.mfa_required is off (default)", () => {
    markAdminSeen(db)
    const { lastInsertRowid } = db
      .prepare(
        "INSERT INTO accounts (email, password_hash, role, can_report) VALUES (?, ?, 'admin', 0)",
      )
      .run("a@x.com", "hash")
    const ctx = getSetupWizardContext(db, {
      authenticated: true,
      isAdmin: true,
      entraSession: false,
      localUserId: Number(lastInsertRowid),
      email: "a@x.com",
    })
    expect(ctx.showMfaStep).toBe(false)
    expect(ctx.steps).toEqual(["person", "timezone", "smtp"])
  })
})
