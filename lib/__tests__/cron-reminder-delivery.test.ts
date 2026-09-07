// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resolveSubscribersForPerson } from "@/lib/push"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
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
    CREATE TABLE push_log (
      ref_key TEXT PRIMARY KEY
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

describe("hydration delivery subscriber filter", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    db.prepare("INSERT INTO people (id, account_uid, is_active) VALUES (?, ?, 1)").run(3, "child-linked")
    db.prepare(
      `INSERT INTO push_endpoints (user_uid, endpoint, p256dh, web_push_auth)
       VALUES (?, 'https://push/a', 'p', 'a'), (?, 'https://push/b', 'p', 'b')`,
    ).run("child-linked", "caregiver-uid")
    db.prepare(
      `INSERT INTO person_notification_prefs
         (person_id, user_uid, notify_hydration)
       VALUES (?, 'child-linked', 1), (?, 'caregiver-uid', 1)`,
    ).run(3, 3)
  })

  afterEach(() => {
    db?.close()
  })

  it("without linked filter returns all hydration subscribers", () => {
    const uids = resolveSubscribersForPerson(db, 3, "notify_hydration").map(r => r.user_uid)
    expect(uids.sort()).toEqual(["caregiver-uid", "child-linked"])
  })

  it("with linked filter returns only the person's linked user_uid", () => {
    const uids = resolveSubscribersForPerson(db, 3, "notify_hydration", {
      linkedAccountOnly: true,
    }).map(r => r.user_uid)
    expect(uids).toEqual(["child-linked"])
  })
})
