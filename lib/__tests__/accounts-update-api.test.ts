// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/db")>()
  return { ...actual, getDb: () => testDb }
})

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => sessionOverride),
}))

let testDb: Database.Database
let sessionOverride: { user: { id: string; email: string }; sessionVersion: number } | null

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
    CREATE TABLE person_notification_prefs (
      user_uid TEXT NOT NULL
    );
    CREATE TABLE push_endpoints (
      user_uid TEXT NOT NULL
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
  db.prepare(
    "INSERT INTO accounts (id, email, password_hash, role, is_active, session_version, totp_secret) VALUES (1, 'admin@example.com', 'h', 'admin', 1, 0, 'secret')",
  ).run()
  return db
}

async function putAccount(id: number, body: Record<string, unknown>) {
  const { PUT } = await import("@/app/api/accounts/[id]/route")
  const req = new NextRequest(`http://localhost/api/accounts/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  })
  return PUT(req, { params: Promise.resolve({ id: String(id) }) })
}

describe("PUT /api/accounts/[id]", () => {
  beforeEach(() => {
    testDb = createTestDb()
    sessionOverride = { user: { id: "local:1", email: "admin@example.com" }, sessionVersion: 0 }
  })

  afterEach(() => {
    testDb.close()
  })

  it("updates role on a local account", async () => {
    testDb.prepare(
      "INSERT INTO accounts (id, email, password_hash, role, auth_method) VALUES (2, 'local@example.com', 'h', 'read', 'local')",
    ).run()

    const res = await putAccount(2, { role: "write" })
    expect(res.status).toBe(200)

    const row = testDb.prepare("SELECT role FROM accounts WHERE id = 2").get() as { role: string }
    expect(row.role).toBe("write")
  })

  it("rejects a role change on an Entra-backed account", async () => {
    testDb.prepare(
      "INSERT INTO accounts (id, email, role, auth_method, external_id, status) VALUES (2, 'entra@example.com', 'read', 'entra', 'oid-1', 'active')",
    ).run()

    const res = await putAccount(2, { role: "admin" })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toBe("This account's access level comes from Entra group membership")

    const row = testDb.prepare("SELECT role FROM accounts WHERE id = 2").get() as { role: string }
    expect(row.role).toBe("read")
  })

  it("still updates reports access on an Entra-backed account", async () => {
    testDb.prepare(
      "INSERT INTO accounts (id, email, role, auth_method, external_id, can_report) VALUES (2, 'entra@example.com', 'read', 'entra', 'oid-1', 0)",
    ).run()

    const res = await putAccount(2, { can_report: 1 })
    expect(res.status).toBe(200)

    const row = testDb.prepare("SELECT can_report, role FROM accounts WHERE id = 2").get() as {
      can_report: number
      role: string
    }
    expect(row.can_report).toBe(1)
    expect(row.role).toBe("read")
  })

  it("clears MFA on a local account", async () => {
    const res = await putAccount(1, { clear_mfa: true })
    expect(res.status).toBe(200)

    const row = testDb.prepare("SELECT totp_secret FROM accounts WHERE id = 1").get() as {
      totp_secret: string | null
    }
    expect(row.totp_secret).toBeNull()
  })
})
