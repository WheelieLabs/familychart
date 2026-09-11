// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { matchOrCreateEntraAccount } from "@/lib/account/account-entra-match"

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
    CREATE TABLE people (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      account_uid TEXT
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

function insertPendingInvite(email: string, opts: { expiresInMs?: number; revoked?: boolean } = {}): number {
  const expiresAt = new Date(Date.now() + (opts.expiresInMs ?? 60 * 60 * 1000)).toISOString()
  const result = testDb
    .prepare(
      `INSERT INTO accounts (email, role, status, auth_method, invite_token_hash, invite_expires_at, invite_revoked_at)
       VALUES (?, 'write', 'invited', 'local', 'hash', ?, ?)`,
    )
    .run(email, expiresAt, opts.revoked ? new Date().toISOString() : null)
  return Number(result.lastInsertRowid)
}

// Invite-claim behaviour (claiming a pending invite, repointing a Person link, case
// insensitivity, claiming an expired/revoked invite) is tested directly on
// lib/invite.ts's claimInviteForEntra in lib/__tests__/invite.test.ts. This file covers only
// what the orchestrator itself owns: dedup, the active-account invariant, and auto-create.
describe("matchOrCreateEntraAccount", () => {
  beforeEach(() => {
    testDb = createTestDb()
  })

  afterEach(() => {
    testDb.close()
  })

  it("claims a pending invite via the Invite module and audits the claim", () => {
    const id = insertPendingInvite("invitee@example.com")
    const result = matchOrCreateEntraAccount(testDb, { oid: "oid-1", email: "invitee@example.com" })
    expect(result.accountId).toBe(id)

    const row = testDb.prepare("SELECT status, auth_method FROM accounts WHERE id = ?").get(id) as {
      status: string
      auth_method: string
    }
    expect(row.status).toBe("active")
    expect(row.auth_method).toBe("entra")

    const audit = testDb.prepare("SELECT action, entity_type, entity_id, details FROM audit_log").get() as {
      action: string
      entity_type: string
      entity_id: number
      details: string
    }
    expect(audit.action).toBe("UPDATE")
    expect(audit.entity_type).toBe("accounts")
    expect(audit.entity_id).toBe(id)
    expect(JSON.parse(audit.details)).toEqual({ invite_claimed_via_entra: true })
  })

  it("never touches an already-active account, even when its email matches — reports its id instead of inserting a duplicate", () => {
    const result1 = testDb
      .prepare(
        "INSERT INTO accounts (email, role, status, auth_method, password_hash) VALUES ('taken@example.com', 'write', 'active', 'local', 'h')",
      )
      .run()
    const existingId = Number(result1.lastInsertRowid)

    const result = matchOrCreateEntraAccount(testDb, { oid: "oid-7", email: "taken@example.com" })
    expect(result.accountId).toBe(existingId)

    const row = testDb.prepare("SELECT auth_method, password_hash, external_id FROM accounts WHERE email = 'taken@example.com'").get() as {
      auth_method: string
      password_hash: string
      external_id: string | null
    }
    expect(row.auth_method).toBe("local")
    expect(row.password_hash).toBe("h")
    expect(row.external_id).toBeNull()

    const all = testDb.prepare("SELECT COUNT(*) as n FROM accounts").get() as { n: number }
    expect(all.n).toBe(1)
  })

  it("auto-creates a new account with an inert 'read' role when there is no pending invite", () => {
    const result = matchOrCreateEntraAccount(testDb, { oid: "oid-4", email: "fresh@example.com" })
    const row = testDb.prepare("SELECT email, role, auth_method, external_id, status FROM accounts WHERE id = ?").get(
      result.accountId,
    ) as { email: string; role: string; auth_method: string; external_id: string; status: string }
    expect(row).toEqual({
      email: "fresh@example.com",
      role: "read",
      auth_method: "entra",
      external_id: "oid-4",
      status: "active",
    })
  })

  it("dedups a repeat sign-in for an existing external_id without creating a duplicate row", () => {
    const first = matchOrCreateEntraAccount(testDb, { oid: "oid-5", email: "repeat@example.com" })
    const second = matchOrCreateEntraAccount(testDb, { oid: "oid-5", email: "repeat@example.com" })
    expect(second.accountId).toBe(first.accountId)

    const all = testDb.prepare("SELECT COUNT(*) as n FROM accounts").get() as { n: number }
    expect(all.n).toBe(1)
  })

  it("auto-creates with a synthetic email when the profile has none", () => {
    const result = matchOrCreateEntraAccount(testDb, { oid: "oid-6", email: null })
    const row = testDb.prepare("SELECT email FROM accounts WHERE id = ?").get(result.accountId) as { email: string }
    expect(row.email).toBe("entra:oid-6")
  })
})
