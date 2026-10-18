// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sendMail = vi.fn()
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail }) },
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from "@/lib/logger"
import { emailAdminsOfEntraRevalidationGap } from "@/lib/push/entra-revalidation-gap-email"

const DAY_MS = 24 * 60 * 60 * 1000
// Sunday 2026-10-11 (ISO week 41), midday UTC.
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0)

const ENV_KEYS = [
  "FC_AUTH_ENTRA_ENABLED",
  "AUTH_MICROSOFT_ENTRA_ID_ID",
  "AUTH_MICROSOFT_ENTRA_ID_TENANT_ID",
  "AUTH_MICROSOFT_ENTRA_ID_SECRET",
  "ENTRA_GROUP_ADMIN",
  "FC_PLATFORM_PROFILE",
  "FC_SMTP_HOST",
  "FC_SMTP_PORT",
  "FC_SMTP_TLS",
  "FC_SMTP_USER",
  "FC_SMTP_PASSWORD",
  "NEXTAUTH_URL",
  "BEHIND_REVERSE_PROXY",
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
      external_id TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE push_endpoints (
      user_uid TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      web_push_auth TEXT NOT NULL,
      PRIMARY KEY (user_uid, endpoint)
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

function configureSmtp(db: Database.Database): void {
  setDbSetting(db, "email.smtp.host", "smtp.example.com")
  setDbSetting(db, "email.smtp.port", "587")
  setDbSetting(db, "email.smtp.tls", "true")
  setDbSetting(db, "email.smtp.password", "secret")
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

function recipients(): string[] {
  return sendMail.mock.calls.map(c => (c[0] as { to: string }).to)
}

describe("emailAdminsOfEntraRevalidationGap", () => {
  let db: Database.Database
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
    process.env.NEXTAUTH_URL = "https://family.example.com"
    sendMail.mockReset()
    vi.mocked(logger.error).mockClear()
    sendMail.mockResolvedValue(undefined)
    db = createTestDb()
    enableEntraWithoutGraph(db)
    configureSmtp(db)
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

  it("emails Admin Accounts without a push subscription, and nobody else", async () => {
    addAccount(db, 3, "admin") // subscribed: the push reaches them
    addAccount(db, 4, "admin", 0) // disabled
    subscribe(db, "local:3")
    subscribe(db, "local:2")

    await emailAdminsOfEntraRevalidationGap(db, NOW)

    expect(recipients()).toEqual(["user1@example.com"])
  })

  it("sends nothing while Entra access is being rechecked (no gap)", async () => {
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "client"
    process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID = "tenant"
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = "secret"

    await emailAdminsOfEntraRevalidationGap(db, NOW)

    expect(sendMail).not.toHaveBeenCalled()
  })

  it("sends nothing when outbound email is not configured", async () => {
    db.prepare("DELETE FROM app_settings WHERE key LIKE 'email.smtp.%'").run()

    await emailAdminsOfEntraRevalidationGap(db, NOW)

    expect(sendMail).not.toHaveBeenCalled()
  })

  it("sends nothing at all while outbound email is unconfigured, then emails once it is set up", async () => {
    db.prepare("DELETE FROM app_settings WHERE key LIKE 'email.smtp.%'").run()
    await emailAdminsOfEntraRevalidationGap(db, NOW)
    expect(sendMail).not.toHaveBeenCalled()

    configureSmtp(db)
    await emailAdminsOfEntraRevalidationGap(db, NOW + DAY_MS / 24)

    expect(recipients()).toEqual(["user1@example.com"])
  })

  it("emails at most once per ISO week while the condition persists", async () => {
    // Thursday and Sunday share ISO week 41; Monday starts week 42.
    await emailAdminsOfEntraRevalidationGap(db, NOW - 3 * DAY_MS)
    await emailAdminsOfEntraRevalidationGap(db, NOW)
    expect(sendMail).toHaveBeenCalledTimes(1)

    await emailAdminsOfEntraRevalidationGap(db, NOW + DAY_MS)
    expect(sendMail).toHaveBeenCalledTimes(2)
  })

  it("emails immediately when the condition returns after it cleared, even in the same week", async () => {
    await emailAdminsOfEntraRevalidationGap(db, NOW)
    expect(sendMail).toHaveBeenCalledTimes(1)

    // Graph is configured: the condition clears.
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "client"
    process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID = "tenant"
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = "secret"
    await emailAdminsOfEntraRevalidationGap(db, NOW + DAY_MS / 24)
    expect(sendMail).toHaveBeenCalledTimes(1)

    // Graph is removed again: the next run emails straight away.
    for (const k of ["AUTH_MICROSOFT_ENTRA_ID_ID", "AUTH_MICROSOFT_ENTRA_ID_TENANT_ID", "AUTH_MICROSOFT_ENTRA_ID_SECRET"]) {
      delete process.env[k]
    }
    await emailAdminsOfEntraRevalidationGap(db, NOW + DAY_MS / 12)
    expect(sendMail).toHaveBeenCalledTimes(2)
  })

  it("carries no personal data and links to the Entra Sessions page on the public origin", async () => {
    await emailAdminsOfEntraRevalidationGap(db, NOW)

    const mail = sendMail.mock.calls[0]![0] as { subject: string; text: string; html: string }
    expect(mail.subject).toBe("FamilyChart: Entra group data is not being rechecked")
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain("https://family.example.com/admin/entra-sessions")
      expect(body).toContain("reminders may still reach someone who has left a group")
      expect(body).toContain("User.Read.All")
      expect(body).not.toContain("user1@example.com")
    }
  })

  it("logs a failed send without throwing, and tries again on the next run", async () => {
    sendMail.mockRejectedValueOnce(new Error("connection refused"))

    await expect(emailAdminsOfEntraRevalidationGap(db, NOW)).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith("outbound_email_failed", expect.anything())

    await emailAdminsOfEntraRevalidationGap(db, NOW + DAY_MS / 24)
    expect(recipients()).toEqual(["user1@example.com", "user1@example.com"])
  })

  it("keeps going past one failed recipient and counts the week as emailed", async () => {
    addAccount(db, 3, "admin")
    sendMail.mockRejectedValueOnce(new Error("mailbox unavailable"))

    await emailAdminsOfEntraRevalidationGap(db, NOW)
    expect(recipients()).toEqual(["user1@example.com", "user3@example.com"])

    await emailAdminsOfEntraRevalidationGap(db, NOW + DAY_MS / 24)
    expect(sendMail).toHaveBeenCalledTimes(2)
  })

  it("does not throw when something unexpected fails, and logs it", async () => {
    db.exec("DROP TABLE push_endpoints")

    await expect(emailAdminsOfEntraRevalidationGap(db, NOW)).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledWith("entra_gap_email_failed", expect.anything())
  })

  it("also reaches Entra Admins, recognised from polled groups, who have no push subscription", async () => {
    process.env.ENTRA_GROUP_ADMIN = "g-admin"
    db.prepare("DELETE FROM accounts WHERE id = 1").run()
    db.prepare(
      `INSERT INTO auth_revalidation_status (provider, external_id, status, groups_json, email, updated_at)
       VALUES ('entra', 'oid-admin', 'ok', '["g-admin"]', 'entra.admin@example.com', ?),
              ('entra', 'oid-pushed', 'ok', '["g-admin"]', 'pushed@example.com', ?),
              ('entra', 'oid-reader', 'ok', '["g-read"]', 'reader@example.com', ?)`,
    ).run(NOW, NOW, NOW)
    subscribe(db, "oid-pushed")

    await emailAdminsOfEntraRevalidationGap(db, NOW)

    expect(recipients()).toEqual(["entra.admin@example.com"])
  })
})
