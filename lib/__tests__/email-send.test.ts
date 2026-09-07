// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildTestEmail, isOutboundEmailConfigured } from "@/lib/email-send"
import {
  SETTING_EMAIL_SMTP_HOST,
  SETTING_EMAIL_SMTP_PASSWORD,
  SETTING_EMAIL_SMTP_PORT,
  SETTING_EMAIL_SMTP_TLS,
} from "@/lib/settings/registry"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE app_settings (
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (key)
    );
  `)
  return db
}

describe("isOutboundEmailConfigured", () => {
  let db: Database.Database
  const originalProfile = process.env.FC_PLATFORM_PROFILE
  const originalGraphTenant = process.env.FC_GRAPH_MAIL_TENANT_ID
  const originalGraphClient = process.env.FC_GRAPH_MAIL_CLIENT_ID
  const originalGraphSecret = process.env.FC_GRAPH_MAIL_CLIENT_SECRET
  const originalHostId = process.env.HOST_ID

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    if (originalProfile === undefined) delete process.env.FC_PLATFORM_PROFILE
    else process.env.FC_PLATFORM_PROFILE = originalProfile
    if (originalGraphTenant === undefined) delete process.env.FC_GRAPH_MAIL_TENANT_ID
    else process.env.FC_GRAPH_MAIL_TENANT_ID = originalGraphTenant
    if (originalGraphClient === undefined) delete process.env.FC_GRAPH_MAIL_CLIENT_ID
    else process.env.FC_GRAPH_MAIL_CLIENT_ID = originalGraphClient
    if (originalGraphSecret === undefined) delete process.env.FC_GRAPH_MAIL_CLIENT_SECRET
    else process.env.FC_GRAPH_MAIL_CLIENT_SECRET = originalGraphSecret
    if (originalHostId === undefined) delete process.env.HOST_ID
    else process.env.HOST_ID = originalHostId
    db?.close()
  })

  it("returns true on managed when Graph mail creds are provisioned", () => {
    process.env.FC_PLATFORM_PROFILE = "managed"
    process.env.HOST_ID = "acme"
    process.env.FC_GRAPH_MAIL_TENANT_ID = "t"
    process.env.FC_GRAPH_MAIL_CLIENT_ID = "c"
    process.env.FC_GRAPH_MAIL_CLIENT_SECRET = "s"
    expect(isOutboundEmailConfigured(db)).toBe(true)
  })

  it("returns false on managed when Graph mail creds missing", () => {
    process.env.FC_PLATFORM_PROFILE = "managed"
    delete process.env.FC_GRAPH_MAIL_TENANT_ID
    expect(isOutboundEmailConfigured(db)).toBe(false)
  })

  it("returns false on self-host when SMTP incomplete", () => {
    delete process.env.FC_PLATFORM_PROFILE
    expect(isOutboundEmailConfigured(db)).toBe(false)
  })

  it("returns true when required SMTP registry fields are complete", () => {
    delete process.env.FC_PLATFORM_PROFILE
    const now = Date.now()
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_EMAIL_SMTP_HOST, "smtp.example.com", now,
    )
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_EMAIL_SMTP_PORT, "587", now,
    )
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_EMAIL_SMTP_TLS, "true", now,
    )
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_EMAIL_SMTP_PASSWORD, "secret", now,
    )
    expect(isOutboundEmailConfigured(db)).toBe(true)
  })
})

describe("buildTestEmail", () => {
  const originalProfile = process.env.FC_PLATFORM_PROFILE

  afterEach(() => {
    if (originalProfile === undefined) delete process.env.FC_PLATFORM_PROFILE
    else process.env.FC_PLATFORM_PROFILE = originalProfile
  })

  it("says SMTP is working, and renders HTML, on a self-hosted (non-managed) instance", () => {
    delete process.env.FC_PLATFORM_PROFILE
    const mail = buildTestEmail()
    expect(mail.subject).toBe("FamilyChart email test")
    expect(mail.text).toBe("This is a test message from your FamilyChart instance. SMTP is working.")
    expect(mail.html).toContain("FamilyChart email test")
    expect(mail.html).toContain("SMTP is working.")
  })

  it("says Graph mail is working on a managed instance", () => {
    process.env.FC_PLATFORM_PROFILE = "managed"
    const mail = buildTestEmail()
    expect(mail.text).toBe("This is a test message from your managed FamilyChart instance. Graph mail is working.")
    expect(mail.html).toContain("Graph mail is working.")
  })
})
