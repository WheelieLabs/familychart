// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { sendOutboundEmail } from "@/lib/email-send"

vi.mock("@/lib/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/db")>()
  return { ...actual, getDb: () => testDb }
})

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => sessionOverride),
}))

vi.mock("@/lib/email-send", () => ({
  isOutboundEmailConfigured: vi.fn(() => emailConfigured),
  sendOutboundEmail: vi.fn(async () => sendResult),
}))

let testDb: Database.Database
let sessionOverride: { user: { id: string; email: string }; sessionVersion: number } | null
let emailConfigured: boolean
let sendResult: { ok: true } | { ok: false; error: string }

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
    CREATE TABLE people (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      account_uid   TEXT,
      is_active     INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX idx_people_account_uid_unique
      ON people(account_uid) WHERE account_uid IS NOT NULL;
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
  db.prepare(
    "INSERT INTO accounts (id, email, password_hash, role, is_active, session_version) VALUES (1, 'admin@example.com', 'h', 'admin', 1, 0)",
  ).run()
  return db
}

function futureIso(): string {
  return new Date(Date.now() + 1000 * 60 * 60).toISOString()
}

function pastIso(): string {
  return new Date(Date.now() - 1000 * 60 * 60).toISOString()
}

async function revokeInvite(id: number) {
  const { POST } = await import("@/app/api/accounts/invites/[id]/revoke/route")
  const req = new NextRequest(`http://localhost/api/accounts/invites/${id}/revoke`, { method: "POST" })
  return POST(req, { params: Promise.resolve({ id: String(id) }) })
}

async function resendInvite(id: number) {
  const { POST } = await import("@/app/api/accounts/invites/[id]/resend/route")
  const req = new NextRequest(`http://localhost/api/accounts/invites/${id}/resend`, { method: "POST" })
  return POST(req, { params: Promise.resolve({ id: String(id) }) })
}

describe("POST /api/accounts/invites/[id]/revoke", () => {
  beforeEach(() => {
    testDb = createTestDb()
    sessionOverride = { user: { id: "local:1", email: "admin@example.com" }, sessionVersion: 0 }
    emailConfigured = true
    sendResult = { ok: true }
  })

  afterEach(() => {
    testDb.close()
  })

  it("revokes a pending invite without touching role or person link", async () => {
    testDb.prepare(
      "INSERT INTO accounts (id, email, role, status, invite_token_hash, invite_expires_at) VALUES (2, 'invitee@example.com', 'manage', 'invited', 'hash', ?)",
    ).run(futureIso())
    testDb.prepare("INSERT INTO people (id, name, account_uid) VALUES (5, 'Alex', 'local:2')").run()

    const res = await revokeInvite(2)
    expect(res.status).toBe(200)

    const row = testDb.prepare("SELECT role, status, invite_revoked_at FROM accounts WHERE id = 2").get() as {
      role: string
      status: string
      invite_revoked_at: string | null
    }
    expect(row.role).toBe("manage")
    expect(row.status).toBe("invited")
    expect(row.invite_revoked_at).toBeTruthy()

    const person = testDb.prepare("SELECT account_uid FROM people WHERE id = 5").get() as { account_uid: string }
    expect(person.account_uid).toBe("local:2")

    const audit = testDb.prepare("SELECT action, entity_type, entity_id FROM audit_log").get() as {
      action: string
      entity_type: string
      entity_id: number
    }
    expect(audit).toEqual({ action: "UPDATE", entity_type: "accounts", entity_id: 2 })
  })

  it("rejects revoking an already-active account", async () => {
    const res = await revokeInvite(1)
    expect(res.status).toBe(409)
  })

  it("rejects revoking an already-revoked invite", async () => {
    testDb.prepare(
      "INSERT INTO accounts (id, email, status, invite_token_hash, invite_expires_at, invite_revoked_at) VALUES (2, 'invitee@example.com', 'invited', 'hash', ?, CURRENT_TIMESTAMP)",
    ).run(futureIso())
    const res = await revokeInvite(2)
    expect(res.status).toBe(409)
  })

  it("rejects a non-admin session", async () => {
    testDb.prepare("UPDATE accounts SET role = 'write' WHERE id = 1").run()
    testDb.prepare(
      "INSERT INTO accounts (id, email, status, invite_token_hash, invite_expires_at) VALUES (2, 'invitee@example.com', 'invited', 'hash', ?)",
    ).run(futureIso())
    const res = await revokeInvite(2)
    expect(res.status).toBe(403)
  })
})

describe("POST /api/accounts/invites/[id]/resend", () => {
  beforeEach(() => {
    testDb = createTestDb()
    sessionOverride = { user: { id: "local:1", email: "admin@example.com" }, sessionVersion: 0 }
    emailConfigured = true
    sendResult = { ok: true }
    vi.mocked(sendOutboundEmail).mockClear()
  })

  afterEach(() => {
    testDb.close()
  })

  it("issues a new token and extends expiry for an expired invite", async () => {
    testDb.prepare(
      "INSERT INTO accounts (id, email, role, status, invite_token_hash, invite_expires_at) VALUES (2, 'invitee@example.com', 'manage', 'invited', 'oldhash', ?)",
    ).run(pastIso())

    const res = await resendInvite(2)
    expect(res.status).toBe(200)

    // The actual regression this guards against: a resend that reports success (200) without
    // ever having called sendOutboundEmail — the earlier assertions on DB state alone
    // wouldn't catch that, since commitInviteResend only runs after a successful send.
    expect(sendOutboundEmail).toHaveBeenCalledTimes(1)
    expect(sendOutboundEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: "invitee@example.com",
        subject: "You've been invited to FamilyChart",
        text: expect.any(String),
        html: expect.any(String),
      }),
    )

    const row = testDb
      .prepare("SELECT role, status, invite_token_hash, invite_expires_at, invite_revoked_at FROM accounts WHERE id = 2")
      .get() as {
      role: string
      status: string
      invite_token_hash: string
      invite_expires_at: string
      invite_revoked_at: string | null
    }
    expect(row.role).toBe("manage")
    expect(row.status).toBe("invited")
    expect(row.invite_token_hash).not.toBe("oldhash")
    expect(new Date(row.invite_expires_at).getTime()).toBeGreaterThan(Date.now())
    expect(row.invite_revoked_at).toBeNull()
  })

  it("clears invite_revoked_at when resending a revoked invite", async () => {
    testDb.prepare(
      "INSERT INTO accounts (id, email, status, invite_token_hash, invite_expires_at, invite_revoked_at) VALUES (2, 'invitee@example.com', 'invited', 'oldhash', ?, CURRENT_TIMESTAMP)",
    ).run(futureIso())

    const res = await resendInvite(2)
    expect(res.status).toBe(200)

    const row = testDb.prepare("SELECT invite_revoked_at, invite_token_hash FROM accounts WHERE id = 2").get() as {
      invite_revoked_at: string | null
      invite_token_hash: string
    }
    expect(row.invite_revoked_at).toBeNull()
    expect(row.invite_token_hash).not.toBe("oldhash")
  })

  it("does not touch an existing person link", async () => {
    testDb.prepare(
      "INSERT INTO accounts (id, email, status, invite_token_hash, invite_expires_at) VALUES (2, 'invitee@example.com', 'invited', 'oldhash', ?)",
    ).run(pastIso())
    testDb.prepare("INSERT INTO people (id, name, account_uid) VALUES (5, 'Alex', 'local:2')").run()

    await resendInvite(2)

    const person = testDb.prepare("SELECT account_uid FROM people WHERE id = 5").get() as { account_uid: string }
    expect(person.account_uid).toBe("local:2")
  })

  it("rejects resending an already-active account", async () => {
    const res = await resendInvite(1)
    expect(res.status).toBe(409)
  })

  it("rejects when outbound email is not configured", async () => {
    emailConfigured = false
    testDb.prepare(
      "INSERT INTO accounts (id, email, status, invite_token_hash, invite_expires_at) VALUES (2, 'invitee@example.com', 'invited', 'oldhash', ?)",
    ).run(pastIso())
    const res = await resendInvite(2)
    expect(res.status).toBe(400)
  })

  it("reports the delivery error and leaves the old token untouched", async () => {
    sendResult = { ok: false, error: "SMTP is not fully configured" }
    testDb.prepare(
      "INSERT INTO accounts (id, email, status, invite_token_hash, invite_expires_at) VALUES (2, 'invitee@example.com', 'invited', 'oldhash', ?)",
    ).run(pastIso())

    const res = await resendInvite(2)
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toBe("SMTP is not fully configured")

    const row = testDb.prepare("SELECT invite_token_hash FROM accounts WHERE id = 2").get() as { invite_token_hash: string }
    expect(row.invite_token_hash).toBe("oldhash")
  })

  it("rejects a non-admin session", async () => {
    testDb.prepare("UPDATE accounts SET role = 'write' WHERE id = 1").run()
    testDb.prepare(
      "INSERT INTO accounts (id, email, status, invite_token_hash, invite_expires_at) VALUES (2, 'invitee@example.com', 'invited', 'oldhash', ?)",
    ).run(pastIso())
    const res = await resendInvite(2)
    expect(res.status).toBe(403)
  })

  it("round-trips revoke then resend back to a live invite", async () => {
    testDb.prepare(
      "INSERT INTO accounts (id, email, status, invite_token_hash, invite_expires_at) VALUES (2, 'invitee@example.com', 'invited', 'hash', ?)",
    ).run(futureIso())

    const revokeRes = await revokeInvite(2)
    expect(revokeRes.status).toBe(200)

    const resendRes = await resendInvite(2)
    expect(resendRes.status).toBe(200)

    const row = testDb.prepare("SELECT invite_revoked_at, status FROM accounts WHERE id = 2").get() as {
      invite_revoked_at: string | null
      status: string
    }
    expect(row.invite_revoked_at).toBeNull()
    expect(row.status).toBe("invited")
  })
})
