// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let testDb: Database.Database
let sessionOverride: { user: { id: string; groups: string[] } }

vi.mock("@/lib/auth/auth-helpers", () => ({
  requireAuth: vi.fn(async () => ({ session: sessionOverride, groups: sessionOverride.user.groups })),
  authorisePersonAccess: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
}))

vi.mock("@/lib/push/push-endpoint-validation", () => ({
  validatePushEndpoint: vi.fn(async () => null),
}))

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      account_uid TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE person_notification_prefs (
      person_id INTEGER NOT NULL,
      user_uid TEXT NOT NULL,
      notify_prn INTEGER NOT NULL DEFAULT 0,
      notify_prescribed INTEGER NOT NULL DEFAULT 0,
      notify_overdue INTEGER NOT NULL DEFAULT 0,
      notify_observations INTEGER NOT NULL DEFAULT 0,
      notify_hydration INTEGER NOT NULL DEFAULT 0,
      UNIQUE(person_id, user_uid)
    );
    CREATE TABLE push_endpoints (
      user_uid TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      web_push_auth TEXT NOT NULL,
      user_agent TEXT,
      last_used_at TEXT,
      UNIQUE(user_uid, endpoint)
    );
  `)
  return db
}

function subscribeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint: "https://fcm.googleapis.com/x", p256dh: "p", auth: "a" }),
  })
}

describe("POST /api/push/subscribe auto-subscribe", () => {
  beforeEach(() => {
    vi.resetModules()
    testDb = createTestDb()
  })

  afterEach(() => {
    testDb.close()
    vi.clearAllMocks()
  })

  it("auto-inserts a prefs row for a Personal-link account's own person", async () => {
    const person = testDb
      .prepare("INSERT INTO people (name, account_uid) VALUES (?, ?) RETURNING id")
      .get("Ben", "local:1") as { id: number }
    sessionOverride = { user: { id: "local:1", groups: ["local:write"] } }

    const { POST } = await import("@/app/api/push/subscribe/route")
    const res = await POST(subscribeRequest())
    expect(res.status).toBe(200)

    const prefs = testDb
      .prepare("SELECT * FROM person_notification_prefs WHERE person_id = ? AND user_uid = ?")
      .get(person.id, "local:1")
    expect(prefs).toBeTruthy()
  })

  it("does not auto-insert prefs for an unrelated Person for a Watcher-only session", async () => {
    const watched = testDb
      .prepare("INSERT INTO people (name, account_uid) VALUES (?, ?) RETURNING id")
      .get("Watched", "local:99") as { id: number }
    // The session's own account holds no Personal-link, but already watches another
    // person via a pre-existing prefs row (e.g. from an earlier explicit subscribe).
    testDb
      .prepare(
        "INSERT INTO person_notification_prefs (person_id, user_uid, notify_prn) VALUES (?, ?, 1)",
      )
      .run(watched.id, "local:2")
    sessionOverride = { user: { id: "local:2", groups: ["local:write"] } }

    const { POST } = await import("@/app/api/push/subscribe/route")
    const res = await POST(subscribeRequest())
    expect(res.status).toBe(200)

    const prefsRows = testDb
      .prepare("SELECT * FROM person_notification_prefs WHERE user_uid = ?")
      .all("local:2")
    // Only the pre-existing watch row — device registration must not plant a new one.
    expect(prefsRows).toHaveLength(1)

    const endpoint = testDb
      .prepare("SELECT * FROM push_endpoints WHERE user_uid = ?")
      .get("local:2")
    expect(endpoint).toBeTruthy()
  })
})
