// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getEntraRevalidationGap } from "@/lib/auth/entra-revalidation-gap"

const HOUR_MS = 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0)

const ENV_KEYS = [
  "FC_AUTH_ENTRA_ENABLED",
  "AUTH_MICROSOFT_ENTRA_ID_ID",
  "AUTH_MICROSOFT_ENTRA_ID_TENANT_ID",
  "AUTH_MICROSOFT_ENTRA_ID_SECRET",
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

/** Entra sign-in is on, with its credentials held in System Settings (not env). */
function enableEntraSignInViaSettings(db: Database.Database): void {
  setDbSetting(db, "auth.entra.enabled", "true")
  setDbSetting(db, "auth.entra.client_id", "client")
  setDbSetting(db, "auth.entra.tenant_id", "tenant")
  setDbSetting(db, "auth.entra.client_secret", "secret")
}

/** Graph revalidation is configured: Entra credentials are present in env. */
function configureGraphViaEnv(): void {
  process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "client"
  process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID = "tenant"
  process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = "secret"
}

function addEntraUser(
  db: Database.Database,
  oid: string,
  fields: { status?: "ok" | "revoked"; groupsJson?: string | null; ageMs: number },
): void {
  db.prepare(
    `INSERT INTO auth_revalidation_status (provider, external_id, status, last_checked_at, groups_json, updated_at)
     VALUES ('entra', ?, ?, NULL, ?, ?)`,
  ).run(oid, fields.status ?? "ok", fields.groupsJson ?? null, NOW - fields.ageMs)
}

describe("getEntraRevalidationGap", () => {
  let db: Database.Database
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
    db = createTestDb()
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    db.close()
  })

  it("reports no gap when Entra sign-in is not active, even with stuck users", () => {
    addEntraUser(db, "oid-stuck", { ageMs: 48 * HOUR_MS })
    expect(getEntraRevalidationGap(db, NOW)).toBeNull()
  })

  it("reports a gap when Entra is active and Graph revalidation is not configured", () => {
    enableEntraSignInViaSettings(db)
    expect(getEntraRevalidationGap(db, NOW)).toEqual({ graphConfigured: false, usersWithoutGroupData: 0 })
  })

  it("reports no gap when Graph is configured and every user has group data", () => {
    enableEntraSignInViaSettings(db)
    configureGraphViaEnv()
    addEntraUser(db, "oid-polled", { groupsJson: '["g-read"]', ageMs: 48 * HOUR_MS })
    expect(getEntraRevalidationGap(db, NOW)).toBeNull()
  })

  it("counts ok users with no group data older than two poll cycles", () => {
    enableEntraSignInViaSettings(db)
    configureGraphViaEnv()
    addEntraUser(db, "oid-stuck-1", { ageMs: 3 * HOUR_MS })
    addEntraUser(db, "oid-stuck-2", { ageMs: 48 * HOUR_MS })
    expect(getEntraRevalidationGap(db, NOW)).toEqual({ graphConfigured: true, usersWithoutGroupData: 2 })
  })

  it("gives a user who signed in within the last two hours time for the first poll", () => {
    enableEntraSignInViaSettings(db)
    configureGraphViaEnv()
    addEntraUser(db, "oid-new", { ageMs: 90 * 60 * 1000 })
    expect(getEntraRevalidationGap(db, NOW)).toBeNull()
  })

  it("ignores revoked users", () => {
    enableEntraSignInViaSettings(db)
    configureGraphViaEnv()
    addEntraUser(db, "oid-revoked", { status: "revoked", ageMs: 48 * HOUR_MS })
    expect(getEntraRevalidationGap(db, NOW)).toBeNull()
  })
})
