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
      id                   INTEGER PRIMARY KEY,
      email                TEXT NOT NULL,
      role                 TEXT NOT NULL,
      is_active            INTEGER NOT NULL DEFAULT 1,
      can_report           INTEGER NOT NULL DEFAULT 0,
      session_version      INTEGER NOT NULL DEFAULT 0,
      auth_method          TEXT NOT NULL DEFAULT 'local',
      status               TEXT NOT NULL DEFAULT 'active',
      invite_expires_at    TEXT,
      invite_revoked_at    TEXT
    );
    CREATE TABLE people (
      id            INTEGER PRIMARY KEY,
      name          TEXT NOT NULL,
      full_name     TEXT,
      photo_url     TEXT,
      color         TEXT,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      is_active     INTEGER NOT NULL DEFAULT 1,
      account_uid   TEXT,
      date_of_birth TEXT
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
    INSERT INTO accounts (id, email, role, session_version) VALUES (1, 'admin@example.com', 'admin', 0);
    INSERT INTO accounts (id, email, role) VALUES (2, 'none@example.com', 'none');
    INSERT INTO accounts (id, email, role) VALUES (3, 'writer@example.com', 'write');
    INSERT INTO accounts (id, email, role) VALUES (4, 'other@example.com', 'read');
    INSERT INTO people (id, name, account_uid, color) VALUES (10, 'Self', 'local:2', '#000');
    INSERT INTO people (id, name, account_uid, color) VALUES (11, 'Carer', 'local:3', '#111');
  `)
  return db
}

async function putPerson(id: number, body: Record<string, unknown>) {
  const { PUT } = await import("@/app/api/people/[id]/route")
  const req = new NextRequest(`http://localhost/api/people/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  })
  return PUT(req, { params: Promise.resolve({ id: String(id) }) })
}

describe("PUT /api/people/[id] Personal-link for Role None", () => {
  beforeEach(() => {
    testDb = createTestDb()
    sessionOverride = { user: { id: "local:1", email: "admin@example.com" }, sessionVersion: 0 }
  })

  afterEach(() => {
    testDb.close()
  })

  it("rejects clearing the Personal-link of a None Account", async () => {
    const res = await putPerson(10, { account_uid: null })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/Personal-link/)
    expect(body.error).toMatch(/None/)

    const row = testDb.prepare("SELECT account_uid, role FROM people p JOIN accounts a ON a.id = 2 WHERE p.id = 10").get() as {
      account_uid: string
      role: string
    }
    expect(row.account_uid).toBe("local:2")
    expect(row.role).toBe("none")
  })

  it("still clears the Personal-link of an Account with a household Role", async () => {
    const res = await putPerson(11, { account_uid: null })
    expect(res.status).toBe(200)
    const row = testDb.prepare("SELECT account_uid FROM people WHERE id = 11").get() as { account_uid: string | null }
    expect(row.account_uid).toBeNull()
  })

  it("still relinks a None Account's Person to another Account", async () => {
    const res = await putPerson(10, { account_uid: "local:4" })
    expect(res.status).toBe(200)
    const row = testDb.prepare("SELECT account_uid FROM people WHERE id = 10").get() as { account_uid: string }
    expect(row.account_uid).toBe("local:4")
  })
})
