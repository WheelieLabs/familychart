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
import { sendSelfDoseAcknowledgementPushes } from "@/lib/push"
import { applyHydrationNotification } from "@/lib/hydration/hydration-notification"
import { HYDRATION_KEY_LAST_NUDGE_AT, HYDRATION_KEY_LAST_RECORD_AT } from "@/lib/hydration/hydration-config"

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
    CREATE TABLE user_settings (
      user_uid TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_uid, key)
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT NOT NULL,
      entity_type TEXT NOT NULL, entity_id INTEGER, details TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE auth_revalidation_status (
      provider TEXT NOT NULL, external_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ok',
      last_checked_at INTEGER, groups_json TEXT, email TEXT, display_name TEXT,
      updated_at INTEGER NOT NULL, PRIMARY KEY (provider, external_id)
    );
  `)
  return db
}

type Sent = { endpoint: string; payload: Record<string, unknown> }
function sentPushes(): Sent[] {
  return vi.mocked(webpush.sendNotification).mock.calls.map(([sub, body]) => ({
    endpoint: (sub as { endpoint: string }).endpoint,
    payload: JSON.parse(body as string) as Record<string, unknown>,
  }))
}

describe("self push notifications", () => {
  let db: Database.Database
  const prevSubject = process.env.VAPID_SUBJECT

  beforeEach(() => {
    db = createTestDb()
    process.env.VAPID_SUBJECT = "mailto:test@example.com"
    vi.mocked(webpush.sendNotification).mockReset()
    vi.mocked(webpush.sendNotification).mockResolvedValue(undefined as never)
    // Person 1 is linked to local:1 (the recorder); local:2 watches.
    db.prepare("INSERT INTO people (id, name, account_uid) VALUES (1, 'Toby', 'local:1')").run()
    db.prepare("INSERT INTO accounts (id, email, display_name, role, is_active) VALUES (1, 'a@t', 'A', 'read', 1)").run()
    db.prepare("INSERT INTO accounts (id, email, display_name, role, is_active) VALUES (2, 'b@t', 'B', 'read', 1)").run()
    for (const [uid, ep] of [
      ["local:1", "https://push/phone"],
      ["local:1", "https://push/tablet"],
      ["local:2", "https://push/watcher"],
    ] as const) {
      db.prepare("INSERT INTO push_endpoints (user_uid, endpoint, p256dh, web_push_auth) VALUES (?, ?, 'p', 'a')").run(uid, ep)
    }
    for (const uid of ["local:1", "local:2"]) {
      db.prepare(
        `INSERT INTO person_notification_prefs
           (person_id, user_uid, notify_prn, notify_prescribed, notify_overdue, notify_hydration)
         VALUES (1, ?, 1, 1, 1, 1)`,
      ).run(uid)
    }
  })

  afterEach(() => {
    if (prevSubject === undefined) delete process.env.VAPID_SUBJECT
    else process.env.VAPID_SUBJECT = prevSubject
    db.close()
  })

  describe("dose acknowledgement to the recorder's other devices", () => {
    const base = {
      personId: 1,
      medicationId: 7,
      recorderUserUids: ["local:1"],
      personName: "Toby",
      medicationName: "Panadol",
      recordedAt: "2025-01-15T08:10:00.000Z",
      tzOffsetMinutes: 0,
    }

    it("replaces the reminder in place on the recorder's other devices only", async () => {
      const res = await sendSelfDoseAcknowledgementPushes(db, { ...base, recordingEndpoint: "https://push/phone" })
      expect(res.sent).toBe(1)
      const pushes = sentPushes()
      expect(pushes.map(p => p.endpoint)).toEqual(["https://push/tablet"])
      expect(pushes[0]!.payload).toMatchObject({
        body: "You gave Toby's Panadol at 8:10 am",
        tag: "medication-reminder-1-7",
      })
    })

    it("falls back to every device of the recorder when the recording device is unknown", async () => {
      await sendSelfDoseAcknowledgementPushes(db, { ...base, recordingEndpoint: null })
      expect(sentPushes().map(p => p.endpoint).sort()).toEqual(["https://push/phone", "https://push/tablet"])
    })

    it("never reaches another account, which keeps its own 'gave' acknowledgement", async () => {
      await sendSelfDoseAcknowledgementPushes(db, { ...base, recordingEndpoint: null })
      expect(sentPushes().map(p => p.endpoint)).not.toContain("https://push/watcher")
    })
  })

  describe("hydration reading", () => {
    const base = { personId: 1, personName: "Toby", settingsUid: "local:1", nowMs: 1_736_935_200_000, recordingEndpoint: "https://push/phone" }
    const setting = (key: string) =>
      (db.prepare("SELECT value FROM user_settings WHERE user_uid = 'local:1' AND key = ?").get(key) as { value: string } | undefined)?.value

    it("sends a quiet update to the linked Account's other devices and keeps the nudge outstanding", async () => {
      await applyHydrationNotification(db, { ...base, decision: { kind: "update", glassesNeededNow: 2 } })
      const pushes = sentPushes()
      expect(pushes.map(p => p.endpoint)).toEqual(["https://push/tablet"])
      expect(pushes[0]!.payload).toMatchObject({ body: "Toby: ≈2 glasses to catch up", tag: "hydration-reminder-1", silent: true })
      expect(setting(HYDRATION_KEY_LAST_NUDGE_AT)).toBe(String(base.nowMs))
    })

    it("sends a brief 'Caught up' to be closed by the service worker and ends the outstanding nudge", async () => {
      await applyHydrationNotification(db, { ...base, decision: { kind: "clear" } })
      const pushes = sentPushes()
      expect(pushes).toHaveLength(1)
      expect(pushes[0]!.payload).toMatchObject({ body: "Toby: Caught up", tag: "hydration-reminder-1", silent: true, closeAfterMs: 4000 })
      expect(setting(HYDRATION_KEY_LAST_RECORD_AT)).toBe(String(base.nowMs))
    })

    it("never reaches a Watcher who is not the linked Account", async () => {
      await applyHydrationNotification(db, { ...base, recordingEndpoint: null, decision: { kind: "clear" } })
      expect(sentPushes().map(p => p.endpoint)).not.toContain("https://push/watcher")
    })

    it("sends and writes nothing when the decision is none (muted today, or nothing outstanding)", async () => {
      await applyHydrationNotification(db, { ...base, decision: { kind: "none" } })
      expect(sentPushes()).toEqual([])
      expect(setting(HYDRATION_KEY_LAST_NUDGE_AT)).toBeUndefined()
      expect(setting(HYDRATION_KEY_LAST_RECORD_AT)).toBeUndefined()
    })

    it("does not add quiet replacements to the notification history", async () => {
      await applyHydrationNotification(db, { ...base, decision: { kind: "update", glassesNeededNow: 1 } })
      expect((db.prepare("SELECT COUNT(*) AS n FROM notification_log").get() as { n: number }).n).toBe(0)
    })
  })
})
