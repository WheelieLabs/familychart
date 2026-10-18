// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue(undefined),
    generateVAPIDKeys: vi.fn(() => ({
      publicKey: "BPtest-public-key-long-enough",
      privateKey: "test-private-key-long-enough",
    })),
  },
}))

import webpush from "web-push"
import { alreadySent, dispatchPersonPush } from "@/lib/push"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#2B7DC2',
      account_uid TEXT, is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY, email TEXT, password_hash TEXT, display_name TEXT,
      role TEXT NOT NULL DEFAULT 'read', can_report INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1, session_version INTEGER NOT NULL DEFAULT 0,
      mfa_secret TEXT, mfa_enabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE push_endpoints (
      user_uid TEXT NOT NULL, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL,
      web_push_auth TEXT NOT NULL, PRIMARY KEY (user_uid, endpoint)
    );
    CREATE TABLE person_notification_prefs (
      person_id INTEGER NOT NULL, user_uid TEXT NOT NULL,
      notify_prn INTEGER NOT NULL DEFAULT 0, notify_prescribed INTEGER NOT NULL DEFAULT 0,
      notify_overdue INTEGER NOT NULL DEFAULT 0, notify_observations INTEGER NOT NULL DEFAULT 0,
      notify_hydration INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (person_id, user_uid)
    );
    CREATE TABLE push_log (ref_key TEXT PRIMARY KEY);
    CREATE TABLE notification_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, recipient_user_id TEXT NOT NULL,
      person_id INTEGER NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE auth_revalidation_status (
      provider TEXT NOT NULL, external_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ok',
      last_checked_at INTEGER, groups_json TEXT, email TEXT, display_name TEXT,
      updated_at INTEGER NOT NULL, PRIMARY KEY (provider, external_id)
    );
  `)
  return db
}

const opts = {
  personId: 1,
  notifyFields: "notify_prn" as const,
  payload: { title: "t", body: "b" },
  type: "prn",
  refKey: "prn:1",
  skipIfAlreadySent: true,
}

describe("dispatchPersonPush claim release", () => {
  let db: Database.Database
  const prevSubject = process.env.VAPID_SUBJECT

  beforeEach(() => {
    db = createTestDb()
    process.env.VAPID_SUBJECT = "mailto:test@example.com"
    vi.mocked(webpush.sendNotification).mockReset()
    vi.mocked(webpush.setVapidDetails).mockReset()
    db.prepare("INSERT INTO people (id, name, account_uid) VALUES (1, 'P', 'local:1')").run()
    db.prepare(
      "INSERT INTO accounts (id, email, display_name, role, is_active) VALUES (1, 'a@t', 'A', 'read', 1)",
    ).run()
    for (const ep of ["https://push/a", "https://push/b"]) {
      db.prepare(
        "INSERT INTO push_endpoints (user_uid, endpoint, p256dh, web_push_auth) VALUES ('local:1', ?, 'p', 'a')",
      ).run(ep)
    }
    db.prepare(
      "INSERT INTO person_notification_prefs (person_id, user_uid, notify_prn) VALUES (1, 'local:1', 1)",
    ).run()
  })

  afterEach(() => {
    if (prevSubject === undefined) delete process.env.VAPID_SUBJECT
    else process.env.VAPID_SUBJECT = prevSubject
    db.close()
  })

  it("releases the claim when every endpoint fails transiently, so the next tick retries", async () => {
    vi.mocked(webpush.sendNotification).mockRejectedValue(
      Object.assign(new Error("boom"), { statusCode: 503 }),
    )
    const first = await dispatchPersonPush(db, opts)
    expect(first.sent).toBe(0)
    expect(first.errors).toHaveLength(2)
    expect(alreadySent(db, "prn:1")).toBe(false)

    vi.mocked(webpush.sendNotification).mockResolvedValue(undefined as never)
    const second = await dispatchPersonPush(db, opts)
    expect(second.sent).toBe(2)
    expect(alreadySent(db, "prn:1")).toBe(true)
  })

  it("keeps the claim when at least one endpoint received it", async () => {
    vi.mocked(webpush.sendNotification)
      .mockRejectedValueOnce(Object.assign(new Error("boom"), { statusCode: 503 }))
      .mockResolvedValueOnce(undefined as never)
    const res = await dispatchPersonPush(db, opts)
    expect(res.sent).toBe(1)
    expect(res.errors).toHaveLength(1)
    expect(alreadySent(db, "prn:1")).toBe(true)
  })

  it("keeps pruning 410 endpoints and does not treat them as transient errors", async () => {
    vi.mocked(webpush.sendNotification).mockRejectedValue(
      Object.assign(new Error("gone"), { statusCode: 410 }),
    )
    const res = await dispatchPersonPush(db, opts)
    expect(res).toEqual({ sent: 0, errors: [] })
    const n = (db.prepare("SELECT COUNT(*) AS n FROM push_endpoints").get() as { n: number }).n
    expect(n).toBe(0)
  })

  it("releases the claim and rethrows when something between claim and send throws", async () => {
    vi.mocked(webpush.setVapidDetails).mockImplementation(() => {
      throw new Error("vapid broke")
    })
    await expect(dispatchPersonPush(db, opts)).rejects.toThrow("vapid broke")
    expect(alreadySent(db, "prn:1")).toBe(false)
  })
})
