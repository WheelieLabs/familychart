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
import {
  dispatchPersonPush,
  getNotificationLogForUser,
  resolveSubscribersForPerson,
  sendAndLogPush,
} from "@/lib/push"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#2B7DC2',
      account_uid TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY,
      email TEXT,
      password_hash TEXT,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'read',
      can_report INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      session_version INTEGER NOT NULL DEFAULT 0,
      mfa_secret TEXT,
      mfa_enabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE push_endpoints (
      user_uid TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      web_push_auth TEXT NOT NULL,
      PRIMARY KEY (user_uid, endpoint)
    );
    CREATE TABLE person_notification_prefs (
      person_id INTEGER NOT NULL,
      user_uid TEXT NOT NULL,
      notify_prn INTEGER NOT NULL DEFAULT 0,
      notify_prescribed INTEGER NOT NULL DEFAULT 0,
      notify_overdue INTEGER NOT NULL DEFAULT 0,
      notify_observations INTEGER NOT NULL DEFAULT 0,
      notify_hydration INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (person_id, user_uid)
    );
    CREATE TABLE push_log (
      ref_key TEXT PRIMARY KEY
    );
    CREATE TABLE notification_log (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_user_id  TEXT NOT NULL,
      person_id          INTEGER NOT NULL REFERENCES people(id),
      type               TEXT NOT NULL,
      title              TEXT NOT NULL,
      body               TEXT NOT NULL,
      sent_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE auth_revalidation_status (
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ok',
      last_checked_at INTEGER,
      groups_json TEXT,
      email TEXT,
      display_name TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (provider, external_id)
    );
  `)
  return db
}

function seedPerson(db: Database.Database, id: number, name: string, userUid: string | null = null) {
  db.prepare(
    "INSERT INTO people (id, name, color, account_uid, is_active) VALUES (?, ?, '#112233', ?, 1)",
  ).run(id, name, userUid)
}

function seedEndpoint(db: Database.Database, userUid: string, endpoint: string) {
  db.prepare(
    `INSERT INTO push_endpoints (user_uid, endpoint, p256dh, web_push_auth)
     VALUES (?, ?, 'p', 'a')`,
  ).run(userUid, endpoint)
}

function seedPrefs(
  db: Database.Database,
  personId: number,
  userUid: string,
  fields: Partial<Record<"notify_prn" | "notify_prescribed" | "notify_hydration", number>>,
) {
  db.prepare(
    `INSERT INTO person_notification_prefs
       (person_id, user_uid, notify_prn, notify_prescribed, notify_overdue, notify_observations, notify_hydration)
     VALUES (?, ?, ?, ?, 0, 0, ?)`,
  ).run(
    personId,
    userUid,
    fields.notify_prn ?? 0,
    fields.notify_prescribed ?? 0,
    fields.notify_hydration ?? 0,
  )
}

describe("resolveSubscribersForPerson", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    seedPerson(db, 3, "Child", "local:1")
    db.prepare(
      `INSERT INTO accounts (id, email, password_hash, display_name, role, can_report, is_active)
       VALUES (1, 'child@test', 'x', 'Child', 'read', 0, 1)`,
    ).run()
    seedEndpoint(db, "local:1", "https://push/child-a")
    seedEndpoint(db, "local:1", "https://push/child-b")
    seedEndpoint(db, "caregiver", "https://push/care")
    seedPrefs(db, 3, "local:1", { notify_prn: 1, notify_hydration: 1 })
    seedPrefs(db, 3, "caregiver", { notify_prn: 1, notify_hydration: 1 })
  })

  afterEach(() => {
    db?.close()
  })

  it("returns all authorised endpoints for a notify field", () => {
    const rows = resolveSubscribersForPerson(db, 3, "notify_prn")
    expect(rows.map(r => r.endpoint).sort()).toEqual([
      "https://push/care",
      "https://push/child-a",
      "https://push/child-b",
    ])
  })

  it("filters to linked account only for hydration", () => {
    const rows = resolveSubscribersForPerson(db, 3, "notify_hydration", {
      linkedAccountOnly: true,
    })
    expect(rows.map(r => r.user_uid)).toEqual(["local:1", "local:1"])
  })

  it("excludes user uids", () => {
    const rows = resolveSubscribersForPerson(db, 3, ["notify_prn", "notify_prescribed"], {
      excludeUserUids: ["local:1"],
    })
    expect(rows.map(r => r.user_uid)).toEqual(["caregiver"])
  })

  it("drops recipients who no longer have access", () => {
    db.prepare("UPDATE accounts SET is_active = 0 WHERE id = 1").run()
    const rows = resolveSubscribersForPerson(db, 3, "notify_prn")
    expect(rows.map(r => r.user_uid)).toEqual(["caregiver"])
  })
})

describe("sendAndLogPush + getNotificationLogForUser", () => {
  let db: Database.Database
  const prevSubject = process.env.VAPID_SUBJECT

  beforeEach(() => {
    db = createTestDb()
    process.env.VAPID_SUBJECT = "mailto:test@example.com"
    vi.mocked(webpush.sendNotification).mockClear()
    vi.mocked(webpush.sendNotification).mockResolvedValue(undefined as never)
    seedPerson(db, 3, "Child", "local:1")
    seedEndpoint(db, "local:1", "https://push/child-a")
    seedEndpoint(db, "local:1", "https://push/child-b")
    seedEndpoint(db, "caregiver", "https://push/care")
  })

  afterEach(() => {
    if (prevSubject === undefined) delete process.env.VAPID_SUBJECT
    else process.env.VAPID_SUBJECT = prevSubject
    db?.close()
  })

  it("writes one notification_log row per distinct recipient, not per device", async () => {
    const endpoints = [
      { user_uid: "local:1", endpoint: "https://push/child-a", p256dh: "p", web_push_auth: "a" },
      { user_uid: "local:1", endpoint: "https://push/child-b", p256dh: "p", web_push_auth: "a" },
      { user_uid: "caregiver", endpoint: "https://push/care", p256dh: "p", web_push_auth: "a" },
    ]
    const result = await sendAndLogPush(
      db,
      endpoints,
      { title: "PRN due", body: "Child needs med" },
      { personId: 3, type: "prn" },
    )
    expect(result.sent).toBe(3)
    expect(webpush.sendNotification).toHaveBeenCalledTimes(3)

    const rows = db
      .prepare("SELECT recipient_user_id, type, title FROM notification_log ORDER BY recipient_user_id")
      .all() as { recipient_user_id: string; type: string; title: string }[]
    expect(rows).toEqual([
      { recipient_user_id: "caregiver", type: "prn", title: "PRN due" },
      { recipient_user_id: "local:1", type: "prn", title: "PRN due" },
    ])
  })

  it("does not write a log row when log is omitted (push test path)", async () => {
    await sendAndLogPush(db, [
      { endpoint: "https://push/care", p256dh: "p", web_push_auth: "a" },
    ], { title: "Test", body: "ping" })
    const n = (db.prepare("SELECT COUNT(*) AS n FROM notification_log").get() as { n: number }).n
    expect(n).toBe(0)
  })

  it("still delivers when notification_log write fails", async () => {
    db.exec("DROP TABLE notification_log")
    const result = await sendAndLogPush(
      db,
      [{ user_uid: "caregiver", endpoint: "https://push/care", p256dh: "p", web_push_auth: "a" }],
      { title: "PRN due", body: "body" },
      { personId: 3, type: "prn" },
    )
    expect(result.sent).toBe(1)
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1)
  })

  it("paginates with records-style cursor", async () => {
    const insert = db.prepare(
      `INSERT INTO notification_log (recipient_user_id, person_id, type, title, body, sent_at)
       VALUES ('caregiver', 3, 'prn', ?, ?, ?)`,
    )
    for (let i = 1; i <= 5; i++) {
      insert.run(`Title ${i}`, `Body ${i}`, `2026-07-0${i} 12:00:00`)
    }

    const page1 = getNotificationLogForUser(db, "caregiver", { limit: 2 })
    expect(page1.rows.map(r => r.title)).toEqual(["Title 5", "Title 4"])
    expect(page1.nextCursor).toEqual({ ts: "2026-07-04 12:00:00", id: page1.rows[1]!.id })

    const page2 = getNotificationLogForUser(db, "caregiver", {
      limit: 2,
      cursor: page1.nextCursor,
    })
    expect(page2.rows.map(r => r.title)).toEqual(["Title 3", "Title 2"])
    expect(page2.nextCursor).not.toBeNull()

    const page3 = getNotificationLogForUser(db, "caregiver", {
      limit: 2,
      cursor: page2.nextCursor,
    })
    expect(page3.rows.map(r => r.title)).toEqual(["Title 1"])
    expect(page3.nextCursor).toBeNull()
  })
})

describe("dispatchPersonPush acknowledgement auth", () => {
  let db: Database.Database
  const prevSubject = process.env.VAPID_SUBJECT

  beforeEach(() => {
    db = createTestDb()
    process.env.VAPID_SUBJECT = "mailto:test@example.com"
    vi.mocked(webpush.sendNotification).mockClear()
    vi.mocked(webpush.sendNotification).mockResolvedValue(undefined as never)
    seedPerson(db, 3, "Child", "local:1")
    db.prepare(
      `INSERT INTO accounts (id, email, password_hash, display_name, role, can_report, is_active)
       VALUES (2, 'revoked@test', 'x', 'Revoked', 'read', 0, 0)`,
    ).run()
    seedEndpoint(db, "local:2", "https://push/revoked")
    seedPrefs(db, 3, "local:2", { notify_prn: 1, notify_prescribed: 1 })
  })

  afterEach(() => {
    if (prevSubject === undefined) delete process.env.VAPID_SUBJECT
    else process.env.VAPID_SUBJECT = prevSubject
    db?.close()
  })

  it("does not send acknowledgement to revoked recipients", async () => {
    const result = await dispatchPersonPush(db, {
      personId: 3,
      notifyFields: ["notify_prn", "notify_prescribed"],
      payload: { title: "Medication given", body: "body" },
      type: "acknowledgement",
    })
    expect(result.sent).toBe(0)
    expect(webpush.sendNotification).not.toHaveBeenCalled()
    const n = (db.prepare("SELECT COUNT(*) AS n FROM notification_log").get() as { n: number }).n
    expect(n).toBe(0)
  })
})
