// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/db")>()
  return { ...actual, getDb: () => testDb }
})

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => sessionOverride),
}))

let testDb: Database.Database
let sessionOverride: { user: { id: string; email: string; name: string }; sessionVersion: number } | null

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      can_report INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      session_version INTEGER NOT NULL DEFAULT 0,
      totp_secret TEXT,
      auth_method TEXT NOT NULL DEFAULT 'local'
    );
    CREATE TABLE people (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      full_name TEXT,
      photo_url TEXT,
      color TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      account_uid TEXT
    );
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE observation_goals (
      person_id INTEGER,
      observation_type TEXT,
      is_active INTEGER,
      target_value REAL
    );
    INSERT INTO accounts (id, email, role, can_report) VALUES (2, 'carer@example.com', 'write', 1);
    INSERT INTO accounts (id, email, role, can_report) VALUES (3, 'self@example.com', 'none', 0);
    INSERT INTO accounts (id, email, role, can_report) VALUES (4, 'reader@example.com', 'read', 0);
    INSERT INTO people (id, name, color, account_uid) VALUES (7, 'Self', '#000', 'local:3');
  `)
  return db
}

describe("GET /api/me report flags", () => {
  beforeEach(() => {
    testDb = createTestDb()
  })

  afterEach(() => {
    testDb.close()
  })

  async function getMe() {
    const { GET } = await import("@/app/api/me/route")
    return GET()
  }

  it("marks Household Reports for a carer with no Personal-link", async () => {
    sessionOverride = { user: { id: "local:2", email: "carer@example.com", name: "Carer" }, sessionVersion: 0 }
    const res = await getMe()
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      householdReports: boolean
      personalLinkPersonId: number | null
      role: string | null
      linkedPerson: unknown
    }
    expect(body.householdReports).toBe(true)
    expect(body.personalLinkPersonId).toBeNull()
    expect(body.role).toBe("readwrite")
    expect(body.linkedPerson).toBeNull()
  })

  it("marks a Personal-link for Role None without Household Reports", async () => {
    sessionOverride = { user: { id: "local:3", email: "self@example.com", name: "Self" }, sessionVersion: 0 }
    const res = await getMe()
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      householdReports: boolean
      personalLinkPersonId: number | null
      role: string | null
    }
    expect(body.householdReports).toBe(false)
    expect(body.personalLinkPersonId).toBe(7)
    expect(body.role).toBeNull()
  })

  it("marks neither flag when the Account has no Household Reports and no Personal-link", async () => {
    sessionOverride = { user: { id: "local:4", email: "reader@example.com", name: "Reader" }, sessionVersion: 0 }
    const res = await getMe()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { householdReports: boolean; personalLinkPersonId: number | null }
    expect(body.householdReports).toBe(false)
    expect(body.personalLinkPersonId).toBeNull()
  })
})
