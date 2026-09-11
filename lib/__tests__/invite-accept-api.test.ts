// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createInvite } from "@/lib/invite"
import { resetAuthRateLimitForTests } from "@/lib/auth/auth-rate-limit"

vi.mock("@/lib/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/db")>()
  return { ...actual, getDb: () => testDb }
})

let testDb: Database.Database

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE accounts (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      email                TEXT NOT NULL UNIQUE,
      password_hash        TEXT,
      role                 TEXT NOT NULL DEFAULT 'write',
      is_active            INTEGER NOT NULL DEFAULT 1,
      can_report           INTEGER NOT NULL DEFAULT 0,
      totp_secret          TEXT,
      totp_secret_pending  TEXT,
      session_version      INTEGER NOT NULL DEFAULT 0,
      auth_method          TEXT NOT NULL DEFAULT 'local',
      external_id          TEXT,
      status               TEXT NOT NULL DEFAULT 'active',
      invite_token_hash    TEXT,
      invite_expires_at    DATETIME,
      invite_revoked_at    DATETIME,
      created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
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

// Matches lib/invite.ts's fixed, non-configurable invite window.
const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

/** Fixture pending Invites via the real createInvite path (deliberate testing decision), not
 * a public token-mint helper. `expiresInMs` is achieved by backdating `nowMs`. */
function insertPendingInvite(email: string, expiresInMs = 60 * 60 * 1000): { token: string; id: number } {
  const nowMs = Date.now() + expiresInMs - INVITE_EXPIRY_MS
  const result = createInvite(testDb, { email, role: "write", personAction: "none" }, { origin: "http://localhost", inviter: {}, nowMs })
  if (!result.ok) throw new Error(`fixture createInvite failed: ${result.reason}`)
  return { token: result.token, id: result.account.id }
}

async function postAccept(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/accounts/invites/accept/route")
  const req = new NextRequest("http://localhost/api/accounts/invites/accept", {
    method: "POST",
    body: JSON.stringify(body),
  })
  return POST(req)
}

describe("POST /api/accounts/invites/accept", () => {
  beforeEach(() => {
    resetAuthRateLimitForTests()
    testDb = createTestDb()
  })

  afterEach(() => {
    testDb.close()
  })

  it("sets the password, activates the account, and returns the email to enable auto sign-in", async () => {
    const { token, id } = insertPendingInvite("invitee@example.com")
    const res = await postAccept({ token, password: "a-strong-new-password", confirmPassword: "a-strong-new-password" })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; email: string }
    expect(body).toEqual({ ok: true, email: "invitee@example.com" })

    const row = testDb
      .prepare("SELECT password_hash, status, invite_token_hash, invite_expires_at FROM accounts WHERE id = ?")
      .get(id) as { password_hash: string; status: string; invite_token_hash: string | null; invite_expires_at: string | null }
    expect(row.password_hash).toBeTruthy()
    expect(row.status).toBe("active")
    expect(row.invite_token_hash).toBeNull()
    expect(row.invite_expires_at).toBeNull()

    const audit = testDb.prepare("SELECT action, entity_type, entity_id FROM audit_log").get() as {
      action: string
      entity_type: string
      entity_id: number
    }
    expect(audit).toEqual({ action: "UPDATE", entity_type: "accounts", entity_id: id })
  })

  it("rejects an expired invite without changing the account", async () => {
    const { token, id } = insertPendingInvite("expired@example.com", -1000)
    const res = await postAccept({ token, password: "a-strong-new-password", confirmPassword: "a-strong-new-password" })
    expect(res.status).toBe(400)
    const row = testDb.prepare("SELECT status, password_hash FROM accounts WHERE id = ?").get(id) as {
      status: string
      password_hash: string | null
    }
    expect(row.status).toBe("invited")
    expect(row.password_hash).toBeNull()
  })

  it("rejects a revoked invite", async () => {
    const { token, id } = insertPendingInvite("revoked@example.com")
    testDb.prepare("UPDATE accounts SET invite_revoked_at = CURRENT_TIMESTAMP WHERE id = ?").run(id)
    const res = await postAccept({ token, password: "a-strong-new-password", confirmPassword: "a-strong-new-password" })
    expect(res.status).toBe(400)
  })

  it("rejects a token used a second time after the first accept succeeds", async () => {
    const { token } = insertPendingInvite("reuse@example.com")
    const first = await postAccept({ token, password: "first-new-password", confirmPassword: "first-new-password" })
    expect(first.status).toBe(200)
    const second = await postAccept({ token, password: "second-new-password", confirmPassword: "second-new-password" })
    expect(second.status).toBe(400)
  })

  it("rejects an unknown token", async () => {
    const res = await postAccept({ token: "not-a-real-token", password: "a-strong-new-password", confirmPassword: "a-strong-new-password" })
    expect(res.status).toBe(400)
  })

  it("rejects an invalid token without paying the bcrypt cost", async () => {
    const bcrypt = await import("bcryptjs")
    const hashSpy = vi.spyOn(bcrypt.default, "hash")
    const res = await postAccept({ token: "not-a-real-token", password: "a-strong-new-password", confirmPassword: "a-strong-new-password" })
    expect(res.status).toBe(400)
    expect(hashSpy).not.toHaveBeenCalled()
  })

  it("rejects mismatched passwords", async () => {
    const { token } = insertPendingInvite("mismatch@example.com")
    const res = await postAccept({ token, password: "a-strong-new-password", confirmPassword: "different" })
    expect(res.status).toBe(400)
  })

  it("rejects a password shorter than the configured minimum", async () => {
    const { token } = insertPendingInvite("short@example.com")
    const res = await postAccept({ token, password: "short", confirmPassword: "short" })
    expect(res.status).toBe(400)
  })

  it("rejects a missing token", async () => {
    const res = await postAccept({ password: "a-strong-new-password", confirmPassword: "a-strong-new-password" })
    expect(res.status).toBe(400)
  })
})
