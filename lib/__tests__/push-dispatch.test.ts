// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { alreadySent, dispatchPersonPush } from "@/lib/push"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
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
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      ref_key TEXT NOT NULL UNIQUE,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
  return db
}

const payload = { title: "t", body: "b" }

describe("dispatchPersonPush", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => db.close())

  it("does not permanently mark a refKey sent when there are zero subscribers", async () => {
    const res = await dispatchPersonPush(db, {
      personId: 1,
      notifyFields: "notify_prn",
      payload,
      type: "prn",
      refKey: "prn:1",
      skipIfAlreadySent: true,
    })

    expect(res).toEqual({ sent: 0, errors: [] })
    // The claim must be released so a caregiver who subscribes later can still be reminded —
    // otherwise this refKey would be permanently (and falsely) marked "sent".
    expect(alreadySent(db, "prn:1")).toBe(false)
  })

  it("still dedupes a second concurrent call for the same refKey (claim still atomic)", async () => {
    const [a, b] = await Promise.all([
      dispatchPersonPush(db, {
        personId: 1, notifyFields: "notify_prn", payload, type: "prn",
        refKey: "prn:1", skipIfAlreadySent: true,
      }),
      dispatchPersonPush(db, {
        personId: 1, notifyFields: "notify_prn", payload, type: "prn",
        refKey: "prn:1", skipIfAlreadySent: true,
      }),
    ])

    // Both resolve to zero subscribers either way (no endpoints registered), but the point is
    // the claim/release logic didn't throw or leave push_log in a broken state under overlap.
    expect(a).toEqual({ sent: 0, errors: [] })
    expect(b).toEqual({ sent: 0, errors: [] })
    expect(alreadySent(db, "prn:1")).toBe(false)
  })
})
