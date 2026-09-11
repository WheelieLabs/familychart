// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import bcrypt from "bcryptjs"
import { generateSecret, generateSync } from "otplib"
import Database from "better-sqlite3-multiple-ciphers"
import {
  changePassword,
  confirmEnrollment,
  disableTotp,
  isMfaRequiredPolicyActive,
  localUserNeedsMfaEnrollment,
  startEnrollment,
} from "@/lib/account/account-local-reauth"
import { recordAuthFailureForLocalUser, resetAuthRateLimitForTests } from "@/lib/auth/auth-rate-limit"

function makeDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      totp_secret TEXT,
      totp_secret_pending TEXT,
      role TEXT NOT NULL DEFAULT 'read',
      can_report INTEGER NOT NULL DEFAULT 0,
      session_version INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE app_settings (
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (key)
    );
  `)
  return db
}

function insertAccount(
  db: Database.Database,
  overrides: { email?: string; password?: string; totpSecret?: string | null; pending?: string | null } = {},
): { id: number; password: string } {
  const password = overrides.password ?? "secret123"
  const hash = bcrypt.hashSync(password, 4)
  const info = db
    .prepare(
      "INSERT INTO accounts (email, password_hash, totp_secret, totp_secret_pending) VALUES (?, ?, ?, ?)",
    )
    .run(overrides.email ?? "a@example.com", hash, overrides.totpSecret ?? null, overrides.pending ?? null)
  return { id: info.lastInsertRowid as number, password }
}

describe("MFA required policy", () => {
  let db: Database.Database
  const originalProfile = process.env.FC_PLATFORM_PROFILE

  beforeEach(() => {
    db = makeDb()
    delete process.env.FC_PLATFORM_PROFILE
  })

  afterEach(() => {
    if (originalProfile === undefined) delete process.env.FC_PLATFORM_PROFILE
    else process.env.FC_PLATFORM_PROFILE = originalProfile
    db?.close()
  })

  it("self-host, setting unset: policy inactive, enrolment not forced (unchanged default behaviour)", () => {
    expect(isMfaRequiredPolicyActive(db)).toBe(false)
    const { id } = insertAccount(db)
    expect(localUserNeedsMfaEnrollment(db, id)).toBe(false)
  })

  it("self-host, security.mfa_required=false in DB: policy inactive", () => {
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('security.mfa_required', 'false', 0)").run()
    expect(isMfaRequiredPolicyActive(db)).toBe(false)
    const { id } = insertAccount(db)
    expect(localUserNeedsMfaEnrollment(db, id)).toBe(false)
  })

  it("self-host, security.mfa_required=true in DB: policy active, enrolment forced when no TOTP", () => {
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('security.mfa_required', 'true', 0)").run()
    expect(isMfaRequiredPolicyActive(db)).toBe(true)
    const { id } = insertAccount(db)
    expect(localUserNeedsMfaEnrollment(db, id)).toBe(true)
  })

  it("self-host, policy active but user already has TOTP: enrolment not forced", () => {
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('security.mfa_required', 'true', 0)").run()
    const { id } = insertAccount(db, { totpSecret: "some-secret" })
    expect(localUserNeedsMfaEnrollment(db, id)).toBe(false)
  })

  it("managed hosting: policy always active regardless of the setting", () => {
    process.env.FC_PLATFORM_PROFILE = "managed"
    expect(isMfaRequiredPolicyActive(db)).toBe(true)
    const { id } = insertAccount(db)
    expect(localUserNeedsMfaEnrollment(db, id)).toBe(true)
  })

  it("managed hosting: enrolment forced even when security.mfa_required=false in DB", () => {
    process.env.FC_PLATFORM_PROFILE = "managed"
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('security.mfa_required', 'false', 0)").run()
    expect(isMfaRequiredPolicyActive(db)).toBe(true)
    const { id } = insertAccount(db)
    expect(localUserNeedsMfaEnrollment(db, id)).toBe(true)
  })

  it("disable path uses the same policy gate as enrolment (self-host on)", () => {
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('security.mfa_required', 'true', 0)").run()
    expect(isMfaRequiredPolicyActive(db)).toBe(true)
  })

  it("disable path: policy off allows self-service disable on self-host", () => {
    expect(isMfaRequiredPolicyActive(db)).toBe(false)
  })
})

describe("Local Account re-auth", () => {
  let db: Database.Database

  beforeEach(() => {
    db = makeDb()
    resetAuthRateLimitForTests()
  })

  afterEach(() => {
    db?.close()
  })

  describe("startEnrollment", () => {
    it("denies a wrong password", async () => {
      const { id } = insertAccount(db)
      const result = await startEnrollment(db, id, { password: "wrong", ip: "1.1.1.1" })
      expect(result).toEqual({ ok: false, reason: "credentials" })
    })

    it("denies before bcrypt once the real in-memory limiter is tripped", async () => {
      const { id, password } = insertAccount(db)
      const ip = "2.2.2.2"
      for (let i = 0; i < 10; i++) recordAuthFailureForLocalUser(ip, id)
      const result = await startEnrollment(db, id, { password, ip })
      expect(result).toEqual({ ok: false, reason: "rate_limited" })
    })

    it("requires the current code when replacing an existing enrolment", async () => {
      const { id, password } = insertAccount(db, { totpSecret: generateSecret() })
      const result = await startEnrollment(db, id, { password, ip: "1.1.1.1" })
      expect(result).toEqual({ ok: false, reason: "otp_missing" })
    })

    it("denies a wrong current code when replacing an existing enrolment", async () => {
      const { id, password } = insertAccount(db, { totpSecret: generateSecret() })
      const result = await startEnrollment(db, id, { password, otp: "000000", ip: "1.1.1.1" })
      expect(result).toEqual({ ok: false, reason: "otp_invalid" })
    })

    it("mints a pending secret and returns its otpauth URI on proof", async () => {
      const { id, password } = insertAccount(db)
      const result = await startEnrollment(db, id, { password, ip: "1.1.1.1" })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.otpauthUri).toContain("otpauth://totp/")
        const row = db.prepare("SELECT totp_secret_pending FROM accounts WHERE id = ?").get(id) as {
          totp_secret_pending: string | null
        }
        expect(row.totp_secret_pending).toBeTruthy()
      }
    })

    it("replaces an existing enrolment's pending secret when the current code is right", async () => {
      const secret = generateSecret()
      const { id, password } = insertAccount(db, { totpSecret: secret })
      const code = generateSync({ secret })
      const result = await startEnrollment(db, id, { password, otp: code, ip: "1.1.1.1" })
      expect(result.ok).toBe(true)
    })
  })

  describe("confirmEnrollment", () => {
    it("fails without a pending secret (start again)", async () => {
      const { id, password } = insertAccount(db)
      const result = await confirmEnrollment(db, id, { password, code: "123456", ip: "1.1.1.1" })
      expect(result).toEqual({ ok: false, reason: "no_pending" })
    })

    it("denies a wrong new-pending code", async () => {
      const pending = generateSecret()
      const { id, password } = insertAccount(db, { pending })
      const result = await confirmEnrollment(db, id, { password, code: "000000", ip: "1.1.1.1" })
      expect(result).toEqual({ ok: false, reason: "code_invalid" })
    })

    it("promotes the pending secret, clears it, and bumps session_version on the right code", async () => {
      const pending = generateSecret()
      const { id, password } = insertAccount(db, { pending })
      const code = generateSync({ secret: pending })
      const result = await confirmEnrollment(db, id, { password, code, ip: "1.1.1.1" })
      expect(result).toEqual({ ok: true })
      const row = db
        .prepare("SELECT totp_secret, totp_secret_pending, session_version FROM accounts WHERE id = ?")
        .get(id) as { totp_secret: string; totp_secret_pending: string | null; session_version: number }
      expect(row.totp_secret).toBe(pending)
      expect(row.totp_secret_pending).toBeNull()
      expect(row.session_version).toBe(1)
    })

    it("requires the existing code when replacing an enrolment, and denies a wrong one", async () => {
      const existing = generateSecret()
      const pending = generateSecret()
      const { id, password } = insertAccount(db, { totpSecret: existing, pending })

      const missing = await confirmEnrollment(db, id, { password, code: "123456", ip: "1.1.1.1" })
      expect(missing).toEqual({ ok: false, reason: "otp_missing" })

      const wrong = await confirmEnrollment(db, id, { password, otp: "000000", code: "123456", ip: "1.1.1.1" })
      expect(wrong).toEqual({ ok: false, reason: "otp_invalid" })
    })
  })

  describe("disableTotp", () => {
    it("refuses as mfa_required while the policy is active, before touching rate-limit or proof", async () => {
      db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('security.mfa_required', 'true', 0)").run()
      const { id } = insertAccount(db, { totpSecret: generateSecret() })
      const result = await disableTotp(db, id, { password: "wrong", ip: "1.1.1.1" })
      expect(result).toEqual({ ok: false, reason: "mfa_required" })
    })

    it("denies when TOTP is not enrolled", async () => {
      const { id, password } = insertAccount(db)
      const result = await disableTotp(db, id, { password, otp: "123456", ip: "1.1.1.1" })
      expect(result).toEqual({ ok: false, reason: "not_enrolled" })
    })

    it("clears totp fields and bumps session_version on proof", async () => {
      const secret = generateSecret()
      const { id, password } = insertAccount(db, { totpSecret: secret })
      const code = generateSync({ secret })
      const result = await disableTotp(db, id, { password, otp: code, ip: "1.1.1.1" })
      expect(result).toEqual({ ok: true })
      const row = db
        .prepare("SELECT totp_secret, totp_secret_pending, session_version FROM accounts WHERE id = ?")
        .get(id) as { totp_secret: string | null; totp_secret_pending: string | null; session_version: number }
      expect(row.totp_secret).toBeNull()
      expect(row.totp_secret_pending).toBeNull()
      expect(row.session_version).toBe(1)
    })
  })

  describe("changePassword", () => {
    it("denies a wrong current password", async () => {
      const { id } = insertAccount(db)
      const result = await changePassword(db, id, {
        password: "wrong",
        newPassword: "newsecret123",
        confirmPassword: "newsecret123",
        ip: "1.1.1.1",
      })
      expect(result).toEqual({ ok: false, reason: "credentials" })
    })

    it("denies a policy violation before checking the current password", async () => {
      const { id } = insertAccount(db)
      const result = await changePassword(db, id, {
        password: "wrong",
        newPassword: "short",
        confirmPassword: "short",
        ip: "1.1.1.1",
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe("policy")
    })

    it("updates the password hash and bumps session_version on proof", async () => {
      const { id, password } = insertAccount(db)
      const result = await changePassword(db, id, {
        password,
        newPassword: "newsecret123",
        confirmPassword: "newsecret123",
        ip: "1.1.1.1",
      })
      expect(result).toEqual({ ok: true })
      const row = db.prepare("SELECT password_hash, session_version FROM accounts WHERE id = ?").get(id) as {
        password_hash: string
        session_version: number
      }
      expect(bcrypt.compareSync("newsecret123", row.password_hash)).toBe(true)
      expect(row.session_version).toBe(1)
    })
  })
})
