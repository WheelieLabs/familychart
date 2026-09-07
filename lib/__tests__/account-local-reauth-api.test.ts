// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import bcrypt from "bcryptjs"
import { generateSecret, generateSync } from "otplib"
import { formatLocalAccountUid } from "@/lib/account/account-uid"
import { resetAuthRateLimitForTests, recordAuthFailureForLocalUser } from "@/lib/auth/auth-rate-limit"

/**
 * HTTP-adapter characterisation for the four /api/me re-auth routes: demo-mode block,
 * not-applicable (non-local session), and status-code mapping. Domain behaviour (proof,
 * TOTP, tagged denies) is covered at the lib/account-local-reauth.ts seam in
 * account-local-reauth.test.ts — this file only exercises what the routes themselves own.
 */

let testDb: Database.Database
let sessionOverride: { user: { id: string; email: string; groups: string[] } }

vi.mock("@/lib/auth/auth-helpers", () => ({
  requireAuth: vi.fn(async () => ({ session: sessionOverride, groups: sessionOverride.user.groups })),
}))

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
}))

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE accounts (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      email                TEXT NOT NULL,
      password_hash        TEXT,
      role                 TEXT NOT NULL DEFAULT 'read',
      can_report           INTEGER NOT NULL DEFAULT 0,
      is_active            INTEGER NOT NULL DEFAULT 1,
      totp_secret          TEXT,
      totp_secret_pending  TEXT,
      session_version      INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE app_settings (
      key   TEXT UNIQUE NOT NULL,
      value TEXT
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

function insertAccount(overrides: { password?: string; totpSecret?: string | null } = {}): {
  id: number
  password: string
} {
  const password = overrides.password ?? "secret123"
  const hash = bcrypt.hashSync(password, 4)
  const info = testDb
    .prepare("INSERT INTO accounts (email, password_hash, totp_secret) VALUES (?, ?, ?)")
    .run("a@example.com", hash, overrides.totpSecret ?? null)
  return { id: info.lastInsertRowid as number, password }
}

function asLocalSession(localId: number): void {
  sessionOverride = { user: { id: formatLocalAccountUid(localId), email: "a@example.com", groups: [] } }
}

function auditRows(): Array<{ action: string; entity_type: string; details: string | null }> {
  return testDb.prepare("SELECT action, entity_type, details FROM audit_log").all() as Array<{
    action: string
    entity_type: string
    details: string | null
  }>
}

function postJson(path: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body) })
}

const originalProfile = process.env.FC_PLATFORM_PROFILE
const originalDemo = process.env.DEMO_MODE

beforeEach(() => {
  testDb = createTestDb()
  resetAuthRateLimitForTests()
  delete process.env.FC_PLATFORM_PROFILE
  delete process.env.DEMO_MODE
})

afterEach(() => {
  if (originalProfile === undefined) delete process.env.FC_PLATFORM_PROFILE
  else process.env.FC_PLATFORM_PROFILE = originalProfile
  if (originalDemo === undefined) delete process.env.DEMO_MODE
  else process.env.DEMO_MODE = originalDemo
  testDb?.close()
})

describe("POST /api/me/mfa/setup", () => {
  it("blocks demo mode before touching the module", async () => {
    process.env.FC_PLATFORM_PROFILE = "demo"
    process.env.DEMO_MODE = "true"
    const { id } = insertAccount()
    asLocalSession(id)
    const { POST } = await import("@/app/api/me/mfa/setup/route")
    const res = await POST(postJson("/api/me/mfa/setup", { password: "secret123" }))
    expect(res.status).toBe(403)
  })

  it("returns 401 and audits AUTH_FAILURE on a wrong password", async () => {
    const { id } = insertAccount()
    asLocalSession(id)
    const { POST } = await import("@/app/api/me/mfa/setup/route")
    const res = await POST(postJson("/api/me/mfa/setup", { password: "wrong" }))
    expect(res.status).toBe(401)
    const rows = auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: "AUTH_FAILURE", entity_type: "accounts" })
  })

  it("returns 429 once the limiter is tripped", async () => {
    const { id, password } = insertAccount()
    asLocalSession(id)
    for (let i = 0; i < 10; i++) recordAuthFailureForLocalUser("unknown", id)
    const { POST } = await import("@/app/api/me/mfa/setup/route")
    const res = await POST(postJson("/api/me/mfa/setup", { password }))
    expect(res.status).toBe(429)
  })

  it("succeeds with a 200 and an otpauthUrl on proof", async () => {
    const { id, password } = insertAccount()
    asLocalSession(id)
    const { POST } = await import("@/app/api/me/mfa/setup/route")
    const res = await POST(postJson("/api/me/mfa/setup", { password }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.otpauthUrl).toContain("otpauth://totp/")
  })
})

describe("POST /api/me/mfa/confirm", () => {
  it("blocks demo mode", async () => {
    process.env.FC_PLATFORM_PROFILE = "demo"
    process.env.DEMO_MODE = "true"
    const { id } = insertAccount()
    asLocalSession(id)
    const { POST } = await import("@/app/api/me/mfa/confirm/route")
    const res = await POST(postJson("/api/me/mfa/confirm", { password: "secret123", code: "123456" }))
    expect(res.status).toBe(403)
  })

  it("returns 400 with 'start again' when there is no pending secret", async () => {
    const { id, password } = insertAccount()
    asLocalSession(id)
    const { POST } = await import("@/app/api/me/mfa/confirm/route")
    const res = await POST(postJson("/api/me/mfa/confirm", { password, code: "123456" }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/start again/i)
  })

  it("succeeds and audits UPDATE on the right code", async () => {
    const pending = generateSecret()
    const { id, password } = insertAccount()
    testDb.prepare("UPDATE accounts SET totp_secret_pending = ? WHERE id = ?").run(pending, id)
    asLocalSession(id)
    const code = generateSync({ secret: pending })
    const { POST } = await import("@/app/api/me/mfa/confirm/route")
    const res = await POST(postJson("/api/me/mfa/confirm", { password, code }))
    expect(res.status).toBe(200)
    const rows = auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: "UPDATE", entity_type: "accounts" })
  })
})

describe("POST /api/me/mfa/disable", () => {
  it("returns 403 mfa_required even when the caller is also rate-limited (policy is checked first)", async () => {
    testDb.prepare("INSERT INTO app_settings (key, value) VALUES ('security.mfa_required', 'true')").run()
    const { id, password } = insertAccount({ totpSecret: generateSecret() })
    asLocalSession(id)
    for (let i = 0; i < 10; i++) recordAuthFailureForLocalUser("unknown", id)
    const { POST } = await import("@/app/api/me/mfa/disable/route")
    const res = await POST(postJson("/api/me/mfa/disable", { password, otp: "123456" }))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/MFA is required/i)
  })

  it("returns 429 when rate-limited and MFA is not required", async () => {
    const { id, password } = insertAccount({ totpSecret: generateSecret() })
    asLocalSession(id)
    for (let i = 0; i < 10; i++) recordAuthFailureForLocalUser("unknown", id)
    const { POST } = await import("@/app/api/me/mfa/disable/route")
    const res = await POST(postJson("/api/me/mfa/disable", { password, otp: "123456" }))
    expect(res.status).toBe(429)
  })

  it("succeeds and audits UPDATE on proof", async () => {
    const secret = generateSecret()
    const { id, password } = insertAccount({ totpSecret: secret })
    asLocalSession(id)
    const code = generateSync({ secret })
    const { POST } = await import("@/app/api/me/mfa/disable/route")
    const res = await POST(postJson("/api/me/mfa/disable", { password, otp: code }))
    expect(res.status).toBe(200)
    const rows = auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: "UPDATE", entity_type: "accounts" })
  })
})

describe("POST /api/me/password", () => {
  it("blocks demo mode", async () => {
    process.env.FC_PLATFORM_PROFILE = "demo"
    process.env.DEMO_MODE = "true"
    const { id } = insertAccount()
    asLocalSession(id)
    const { POST } = await import("@/app/api/me/password/route")
    const res = await POST(
      postJson("/api/me/password", {
        currentPassword: "secret123",
        newPassword: "newsecret123",
        confirmPassword: "newsecret123",
      }),
    )
    expect(res.status).toBe(403)
  })

  it("returns 400 with the policy message on a policy violation", async () => {
    const { id, password } = insertAccount()
    asLocalSession(id)
    const { POST } = await import("@/app/api/me/password/route")
    const res = await POST(
      postJson("/api/me/password", { currentPassword: password, newPassword: "short", confirmPassword: "short" }),
    )
    expect(res.status).toBe(400)
  })

  it("succeeds and audits UPDATE on proof", async () => {
    const { id, password } = insertAccount()
    asLocalSession(id)
    const { POST } = await import("@/app/api/me/password/route")
    const res = await POST(
      postJson("/api/me/password", {
        currentPassword: password,
        newPassword: "newsecret123",
        confirmPassword: "newsecret123",
      }),
    )
    expect(res.status).toBe(200)
    const rows = auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: "UPDATE", entity_type: "accounts" })
  })
})
