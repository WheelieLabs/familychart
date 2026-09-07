import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  prunePushSubscriptionsForUserUids,
  pushSubscriberStillAuthorised,
} from "@/lib/push/push-subscriptions"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      can_report INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      session_version INTEGER NOT NULL DEFAULT 0,
      totp_secret TEXT,
      totp_secret_pending TEXT
    );
    CREATE TABLE people (
      id INTEGER PRIMARY KEY,
      account_uid TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
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
    CREATE TABLE auth_revalidation_status (
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      status TEXT NOT NULL,
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

describe("prunePushSubscriptionsForUserUids", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    db.prepare(
      `INSERT INTO push_endpoints (user_uid, endpoint, p256dh, web_push_auth)
       VALUES ('local:1', 'https://push/a', 'p', 'a'),
              ('local:2', 'https://push/b', 'p', 'b')`,
    ).run()
    db.prepare(
      `INSERT INTO person_notification_prefs (person_id, user_uid, notify_prn)
       VALUES (3, 'local:1', 1), (4, 'local:2', 1)`,
    ).run()
  })

  afterEach(() => {
    db?.close()
  })

  it("removes push endpoints and notification prefs for the given uids", () => {
    prunePushSubscriptionsForUserUids(db, ["local:1"])

    expect(
      db.prepare("SELECT COUNT(*) AS n FROM push_endpoints WHERE user_uid = 'local:1'").get() as { n: number },
    ).toEqual({ n: 0 })
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM person_notification_prefs WHERE user_uid = 'local:1'")
        .get() as { n: number },
    ).toEqual({ n: 0 })
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM push_endpoints WHERE user_uid = 'local:2'").get() as { n: number },
    ).toEqual({ n: 1 })
  })
})

describe("pushSubscriberStillAuthorised", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    db.prepare(
      `INSERT INTO accounts (id, email, password_hash, role, can_report, is_active)
       VALUES (1, 'carer@example.com', 'hash', 'read', 0, 1),
              (2, 'offboarded@example.com', 'hash', 'read', 0, 0)`,
    ).run()
    db.prepare("INSERT INTO people (id, account_uid, is_active) VALUES (3, 'child-linked', 1)").run()
  })

  afterEach(() => {
    db?.close()
  })

  it("returns false for deactivated local accounts", () => {
    expect(pushSubscriberStillAuthorised(db, "local:2", 3)).toBe(false)
  })

  it("returns true for active local accounts with read access", () => {
    expect(pushSubscriberStillAuthorised(db, "local:1", 3)).toBe(true)
  })

  it("returns false when the person is inactive", () => {
    db.prepare("UPDATE people SET is_active = 0 WHERE id = 3").run()
    expect(pushSubscriberStillAuthorised(db, "local:1", 3)).toBe(false)
  })

  it("returns false for revoked Entra OIDs", () => {
    db.prepare(
      `INSERT INTO auth_revalidation_status (provider, external_id, status, last_checked_at, groups_json, updated_at)
       VALUES ('entra', 'oid-revoked', 'revoked', ?, '["g-read"]', ?)`,
    ).run(Date.now(), Date.now())
    expect(pushSubscriberStillAuthorised(db, "oid-revoked", 3)).toBe(false)
  })

  it("uses polled Entra groups for canReadForPerson when groups_json is set", () => {
    process.env.ENTRA_GROUP_READONLY = "g-read"
    db.prepare(
      `INSERT INTO auth_revalidation_status (provider, external_id, status, last_checked_at, groups_json, updated_at)
       VALUES ('entra', 'oid-admin', 'ok', ?, ?, ?)`,
    ).run(Date.now(), JSON.stringify(["g-other"]), Date.now())
    expect(pushSubscriberStillAuthorised(db, "oid-admin", 3)).toBe(false)

    db.prepare(`UPDATE auth_revalidation_status SET groups_json = ? WHERE external_id = 'oid-admin'`).run(
      JSON.stringify(["g-read"]),
    )
    expect(pushSubscriberStillAuthorised(db, "oid-admin", 3)).toBe(true)
    delete process.env.ENTRA_GROUP_READONLY
  })

  it("fail-opens for Entra OID with no revalidation row yet", () => {
    expect(pushSubscriberStillAuthorised(db, "oid-unknown", 3)).toBe(true)
  })

  it("allows personal-link Entra OID with empty groups_json array", () => {
    db.prepare("UPDATE people SET account_uid = 'oid-linked' WHERE id = 3").run()
    db.prepare(
      `INSERT INTO auth_revalidation_status (provider, external_id, status, last_checked_at, groups_json, updated_at)
       VALUES ('entra', 'oid-linked', 'ok', ?, '[]', ?)`,
    ).run(Date.now(), Date.now())
    expect(pushSubscriberStillAuthorised(db, "oid-linked", 3)).toBe(true)
  })
})
