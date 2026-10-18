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
import { notifyAdminsOfEntraRevalidationGap } from "@/lib/push/entra-revalidation-gap-push"

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
// Sunday 2026-10-11 (ISO week 41), midday UTC.
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0)

const ENV_KEYS = [
  "FC_AUTH_ENTRA_ENABLED",
  "AUTH_MICROSOFT_ENTRA_ID_ID",
  "AUTH_MICROSOFT_ENTRA_ID_TENANT_ID",
  "AUTH_MICROSOFT_ENTRA_ID_SECRET",
  "ENTRA_GROUP_ADMIN",
  "VAPID_SUBJECT",
] as const

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE app_settings (
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (key)
    );
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      auth_method TEXT NOT NULL DEFAULT 'local',
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE push_endpoints (
      user_uid TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      web_push_auth TEXT NOT NULL,
      PRIMARY KEY (user_uid, endpoint)
    );
    CREATE TABLE push_log (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      ref_key TEXT NOT NULL UNIQUE,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE notification_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_user_id TEXT NOT NULL,
      person_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE auth_revalidation_status (
      provider        TEXT NOT NULL,
      external_id     TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'ok',
      last_checked_at INTEGER,
      groups_json     TEXT,
      email           TEXT,
      display_name    TEXT,
      updated_at      INTEGER NOT NULL,
      PRIMARY KEY (provider, external_id)
    );
  `)
  return db
}

function setDbSetting(db: Database.Database, key: string, value: string): void {
  db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(key, value, NOW)
}

/** Entra sign-in is on with credentials in System Settings only, so Graph is not configured. */
function enableEntraWithoutGraph(db: Database.Database): void {
  setDbSetting(db, "auth.entra.enabled", "true")
  setDbSetting(db, "auth.entra.client_id", "client")
  setDbSetting(db, "auth.entra.tenant_id", "tenant")
  setDbSetting(db, "auth.entra.client_secret", "secret")
}

function addAccount(db: Database.Database, id: number, role: string, isActive = 1): void {
  db.prepare("INSERT INTO accounts (id, email, role, is_active) VALUES (?, ?, ?, ?)").run(
    id,
    `user${id}@example.com`,
    role,
    isActive,
  )
}

function subscribe(db: Database.Database, userUid: string): void {
  db.prepare(
    "INSERT INTO push_endpoints (user_uid, endpoint, p256dh, web_push_auth) VALUES (?, ?, 'p', 'a')",
  ).run(userUid, `https://push/${userUid}`)
}

function sentEndpoints(): string[] {
  return vi.mocked(webpush.sendNotification).mock.calls.map(c => (c[0] as { endpoint: string }).endpoint)
}

describe("notifyAdminsOfEntraRevalidationGap", () => {
  let db: Database.Database
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
    process.env.VAPID_SUBJECT = "mailto:test@example.com"
    vi.mocked(webpush.sendNotification).mockClear()
    db = createTestDb()
    enableEntraWithoutGraph(db)
    addAccount(db, 1, "admin")
    addAccount(db, 2, "read")
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    db.close()
  })

  it("pushes to Admin Accounts that have a push subscription, and to nobody else", async () => {
    addAccount(db, 3, "admin") // an admin who never subscribed
    subscribe(db, "local:1")
    subscribe(db, "local:2")

    const result = await notifyAdminsOfEntraRevalidationGap(db, NOW)

    expect(result).toEqual({ sent: 1, errors: [] })
    expect(sentEndpoints()).toEqual(["https://push/local:1"])
  })

  it("carries no personal data and deep-links to the Entra Sessions page", async () => {
    subscribe(db, "local:1")

    await notifyAdminsOfEntraRevalidationGap(db, NOW)

    const payload = JSON.parse(vi.mocked(webpush.sendNotification).mock.calls[0]![1] as string)
    expect(payload.body).toBe("Entra access isn't being rechecked. Tap to see what to do.")
    expect(payload.data.url).toBe("/admin/entra-sessions")
    expect(JSON.stringify(payload)).not.toContain("example.com")
  })

  it("sends at most once per ISO week while the condition persists", async () => {
    subscribe(db, "local:1")

    // Thursday and Sunday share ISO week 41; Monday starts week 42.
    await notifyAdminsOfEntraRevalidationGap(db, NOW - 3 * DAY_MS)
    const sameWeek = await notifyAdminsOfEntraRevalidationGap(db, NOW)
    expect(sameWeek).toEqual({ sent: 0, errors: [] })
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1)

    const nextWeek = await notifyAdminsOfEntraRevalidationGap(db, NOW + DAY_MS)
    expect(nextWeek.sent).toBe(1)
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2)
  })

  it("sends nothing once Graph group data flows (no gap)", async () => {
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "client"
    process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID = "tenant"
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = "secret"
    subscribe(db, "local:1")

    const result = await notifyAdminsOfEntraRevalidationGap(db, NOW)

    expect(result).toEqual({ sent: 0, errors: [] })
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })

  it("does not record a notification-history entry", async () => {
    subscribe(db, "local:1")

    await notifyAdminsOfEntraRevalidationGap(db, NOW)

    expect(db.prepare("SELECT COUNT(*) AS n FROM notification_log").get()).toEqual({ n: 0 })
  })

  it("does not use up the week when no Admin has subscribed yet", async () => {
    await notifyAdminsOfEntraRevalidationGap(db, NOW)
    subscribe(db, "local:1")

    const result = await notifyAdminsOfEntraRevalidationGap(db, NOW + HOUR_MS)

    expect(result.sent).toBe(1)
  })

  it("also reaches Entra Admins whose polled groups include the admin group", async () => {
    process.env.ENTRA_GROUP_ADMIN = "g-admin"
    db.prepare(
      `INSERT INTO auth_revalidation_status (provider, external_id, status, groups_json, updated_at)
       VALUES ('entra', 'oid-admin', 'ok', '["g-admin"]', ?), ('entra', 'oid-reader', 'ok', '["g-read"]', ?)`,
    ).run(NOW, NOW)
    subscribe(db, "oid-admin")
    subscribe(db, "oid-reader")

    await notifyAdminsOfEntraRevalidationGap(db, NOW)

    expect(sentEndpoints()).toEqual(["https://push/oid-admin"])
  })
})
