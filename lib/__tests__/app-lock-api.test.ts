// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import bcrypt from "bcryptjs"
import { formatLocalAccountUid } from "@/lib/account/account-uid"
import { resetAuthRateLimitForTests, recordAuthFailureForLocalUser } from "@/lib/auth/auth-rate-limit"
import { ENTRA_APP_LOCK_REAUTH_MAX_AGE_MS } from "@/lib/app-lock/app-lock-reauth"
import { vi } from "vitest"

/**
 * HTTP-adapter characterisation for the two new /api/me/app-lock routes (ADR-0016).
 * Domain behaviour (proof, TOTP, freshness) is covered at the
 * lib/account/account-local-reauth.ts and lib/app-lock/app-lock-reauth.ts seams.
 */

let testDb: Database.Database
let sessionOverride: {
  user: { id: string; email: string; groups: string[]; entraOid?: string }
  entraAuthAt?: number
}

vi.mock("@/lib/auth/auth-helpers", () => ({
  requireAuth: vi.fn(async () => ({ session: sessionOverride, groups: sessionOverride.user.groups })),
}))

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
}))

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE accounts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      email           TEXT NOT NULL,
      password_hash   TEXT,
      totp_secret     TEXT,
      is_active       INTEGER NOT NULL DEFAULT 1,
      session_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email  TEXT,
      action      TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id   INTEGER,
      details     TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
  return db
}

function insertAccount(overrides: { password?: string } = {}): { id: number; password: string } {
  const password = overrides.password ?? "secret123"
  const hash = bcrypt.hashSync(password, 4)
  const info = testDb
    .prepare("INSERT INTO accounts (email, password_hash) VALUES (?, ?)")
    .run("a@example.com", hash)
  return { id: info.lastInsertRowid as number, password }
}

function asLocalSession(localId: number): void {
  sessionOverride = { user: { id: formatLocalAccountUid(localId), email: "a@example.com", groups: [] } }
}

function asEntraSession(entraAuthAt: number | undefined): void {
  sessionOverride = {
    user: { id: "entra-oid-123", email: "e@example.com", groups: [], entraOid: "entra-oid-123" },
    entraAuthAt,
  }
}

function auditRows(): Array<{ action: string; entity_type: string }> {
  return testDb.prepare("SELECT action, entity_type FROM audit_log").all() as Array<{
    action: string
    entity_type: string
  }>
}

function postJson(path: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body) })
}

beforeEach(() => {
  testDb = createTestDb()
  resetAuthRateLimitForTests()
})

afterEach(() => {
  testDb?.close()
})

describe("POST /api/me/app-lock/reauth-grant", () => {
  it("grants on the right local password", async () => {
    const { id, password } = insertAccount()
    asLocalSession(id)
    const { POST } = await import("@/app/api/me/app-lock/reauth-grant/route")
    const res = await POST(postJson("/api/me/app-lock/reauth-grant", { password }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ granted: true })
    expect(auditRows()).toEqual([{ action: "AUTH_SUCCESS", entity_type: "accounts" }])
  })

  it("returns 401 and audits AUTH_FAILURE on a wrong local password", async () => {
    const { id } = insertAccount()
    asLocalSession(id)
    const { POST } = await import("@/app/api/me/app-lock/reauth-grant/route")
    const res = await POST(postJson("/api/me/app-lock/reauth-grant", { password: "wrong" }))
    expect(res.status).toBe(401)
    expect(auditRows()).toEqual([{ action: "AUTH_FAILURE", entity_type: "accounts" }])
  })

  it("returns 429 once the local rate limiter is tripped", async () => {
    const { id, password } = insertAccount()
    asLocalSession(id)
    for (let i = 0; i < 10; i++) recordAuthFailureForLocalUser("unknown", id)
    const { POST } = await import("@/app/api/me/app-lock/reauth-grant/route")
    const res = await POST(postJson("/api/me/app-lock/reauth-grant", { password }))
    expect(res.status).toBe(429)
  })

  it("grants on a fresh Entra sign-in timestamp", async () => {
    asEntraSession(Date.now())
    const { POST } = await import("@/app/api/me/app-lock/reauth-grant/route")
    const res = await POST(postJson("/api/me/app-lock/reauth-grant", {}))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ granted: true })
  })

  it("returns 401 for a stale Entra sign-in timestamp", async () => {
    asEntraSession(Date.now() - ENTRA_APP_LOCK_REAUTH_MAX_AGE_MS - 1)
    const { POST } = await import("@/app/api/me/app-lock/reauth-grant/route")
    const res = await POST(postJson("/api/me/app-lock/reauth-grant", {}))
    expect(res.status).toBe(401)
  })

  it("returns 401 for an Entra session with no sign-in timestamp at all", async () => {
    asEntraSession(undefined)
    const { POST } = await import("@/app/api/me/app-lock/reauth-grant/route")
    const res = await POST(postJson("/api/me/app-lock/reauth-grant", {}))
    expect(res.status).toBe(401)
  })
})

describe("POST /api/me/app-lock/failure-log", () => {
  it("accepts a well-formed report and never persists credential data", async () => {
    const { id } = insertAccount()
    asLocalSession(id)
    const { POST } = await import("@/app/api/me/app-lock/failure-log/route")
    const res = await POST(
      postJson("/api/me/app-lock/failure-log", {
        phase: "get",
        errorName: "NotAllowedError",
        elapsedMs: 8123,
        userAgent: "Mozilla/5.0 (test)",
      }),
    )
    expect(res.status).toBe(200)
  })

  it("rejects an unexpected field (e.g. a credential id)", async () => {
    const { id } = insertAccount()
    asLocalSession(id)
    const { POST } = await import("@/app/api/me/app-lock/failure-log/route")
    const res = await POST(
      postJson("/api/me/app-lock/failure-log", {
        phase: "get",
        errorName: "NotAllowedError",
        elapsedMs: 1,
        userAgent: "ua",
        credentialId: "should-never-be-accepted",
      }),
    )
    expect(res.status).toBe(400)
  })

  it("rejects an invalid phase", async () => {
    const { id } = insertAccount()
    asLocalSession(id)
    const { POST } = await import("@/app/api/me/app-lock/failure-log/route")
    const res = await POST(
      postJson("/api/me/app-lock/failure-log", {
        phase: "not-a-real-phase",
        errorName: "NotAllowedError",
        elapsedMs: 1,
        userAgent: "ua",
      }),
    )
    expect(res.status).toBe(400)
  })

  it("rate-limits repeated reports from the same account", async () => {
    const { id } = insertAccount()
    asLocalSession(id)
    const { POST } = await import("@/app/api/me/app-lock/failure-log/route")
    const report = {
      phase: "get",
      errorName: "NotAllowedError",
      elapsedMs: 1,
      userAgent: "ua",
    }
    let lastStatus = 0
    for (let i = 0; i < 25; i++) {
      lastStatus = (await POST(postJson("/api/me/app-lock/failure-log", report))).status
    }
    expect(lastStatus).toBe(429)
  })
})
