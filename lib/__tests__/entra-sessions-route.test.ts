// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth/auth-helpers", () => ({
  requireAdmin: vi.fn(async () => ({ session: { user: { email: "admin@test" } }, groups: ["local:admin"] })),
}))

let testDb: Database.Database

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
}))

const ENV_KEYS = [
  "FC_AUTH_ENTRA_ENABLED",
  "AUTH_MICROSOFT_ENTRA_ID_ID",
  "AUTH_MICROSOFT_ENTRA_ID_TENANT_ID",
  "AUTH_MICROSOFT_ENTRA_ID_SECRET",
  "FC_PLATFORM_PROFILE",
  "FC_SMTP_HOST",
  "FC_SMTP_PASSWORD",
] as const

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
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

describe("GET /api/admin/entra-sessions", () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
    testDb = createTestDb()
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    testDb.close()
  })

  it("reports no revalidation gap when Entra sign-in is not active", async () => {
    const { GET } = await import("@/app/api/admin/entra-sessions/route")
    const body = await (await GET()).json()
    expect(body.revalidationGap).toBeNull()
  })

  it("reports the revalidation gap when Entra is active without Graph configured", async () => {
    testDb
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES
         ('auth.entra.enabled', 'true', 0), ('auth.entra.client_id', 'c', 0),
         ('auth.entra.tenant_id', 't', 0), ('auth.entra.client_secret', 's', 0)`,
      )
      .run()
    const { GET } = await import("@/app/api/admin/entra-sessions/route")
    const body = await (await GET()).json()
    expect(body.revalidationGap).toEqual({ graphConfigured: false, usersWithoutGroupData: 0 })
  })

  it("says whether outbound email is configured, for the email-alerts line on the warning", async () => {
    const { GET } = await import("@/app/api/admin/entra-sessions/route")
    expect((await (await GET()).json()).outboundEmailConfigured).toBe(false)

    testDb
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES
         ('email.smtp.host', 'smtp.example.com', 0), ('email.smtp.port', '587', 0),
         ('email.smtp.tls', 'true', 0), ('email.smtp.password', 's', 0)`,
      )
      .run()
    expect((await (await GET()).json()).outboundEmailConfigured).toBe(true)
  })
})
