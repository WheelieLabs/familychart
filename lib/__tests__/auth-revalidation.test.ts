// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ensureAuthRevalidationRow,
  evaluateEntraSessionValidity,
  getAuthRevalidationStatus,
  listAuthRevalidationStatuses,
  pollEntraRevalidation,
  resolveEntraJwtGroups,
  revokeAuthRevalidation,
  shouldPollAuthRevalidation,
} from "@/lib/auth/auth-revalidation"
import { __resetAppOnlyGraphTokenCacheForTests, __setAppOnlyGraphTokenAdapterForTests } from "@/lib/entra-graph-token"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
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
    CREATE TABLE system_config (
      key TEXT UNIQUE NOT NULL,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
  return db
}

describe("evaluateEntraSessionValidity", () => {
  const HOUR = 3_600_000
  const nowMs = 10 * HOUR

  it("invalidates immediately when status is revoked, regardless of staleness", () => {
    expect(
      evaluateEntraSessionValidity({
        status: "revoked",
        lastCheckedAt: nowMs,
        authAt: nowMs,
        maxAgeMs: 8 * HOUR,
        nowMs,
      }),
    ).toBe(false)
  })

  it("valid when last successful revalidation is within the fail-safe bound", () => {
    expect(
      evaluateEntraSessionValidity({
        status: "ok",
        lastCheckedAt: nowMs - 2 * HOUR,
        authAt: nowMs - 5 * HOUR,
        maxAgeMs: 8 * HOUR,
        nowMs,
      }),
    ).toBe(true)
  })

  it("invalid once time since last successful revalidation exceeds the fail-safe bound", () => {
    expect(
      evaluateEntraSessionValidity({
        status: "ok",
        lastCheckedAt: nowMs - 9 * HOUR,
        authAt: nowMs - 20 * HOUR,
        maxAgeMs: 8 * HOUR,
        nowMs,
      }),
    ).toBe(false)
  })

  it("falls back to sign-in time (authAt) when never yet revalidated", () => {
    expect(
      evaluateEntraSessionValidity({
        status: "ok",
        lastCheckedAt: null,
        authAt: nowMs - 1 * HOUR,
        maxAgeMs: 8 * HOUR,
        nowMs,
      }),
    ).toBe(true)
    expect(
      evaluateEntraSessionValidity({
        status: "ok",
        lastCheckedAt: null,
        authAt: nowMs - 9 * HOUR,
        maxAgeMs: 8 * HOUR,
        nowMs,
      }),
    ).toBe(false)
  })

  it("invalid when both lastCheckedAt and authAt are unknown", () => {
    expect(
      evaluateEntraSessionValidity({
        status: "ok",
        lastCheckedAt: null,
        authAt: null,
        maxAgeMs: 8 * HOUR,
        nowMs,
      }),
    ).toBe(false)
  })

  it("status null (no tracking row yet) behaves like 'ok', not revoked", () => {
    expect(
      evaluateEntraSessionValidity({
        status: null,
        lastCheckedAt: null,
        authAt: nowMs,
        maxAgeMs: 8 * HOUR,
        nowMs,
      }),
    ).toBe(true)
  })
})

describe("resolveEntraJwtGroups", () => {
  it("keeps token groups when polled groups are null (pre-first poll)", () => {
    expect(resolveEntraJwtGroups(["g-admin"], null)).toEqual(["g-admin"])
    expect(resolveEntraJwtGroups(undefined, null)).toEqual([])
  })

  it("replaces with polled groups when present (including empty demotion)", () => {
    expect(resolveEntraJwtGroups(["g-admin"], ["g-read"])).toEqual(["g-read"])
    expect(resolveEntraJwtGroups(["g-admin"], [])).toEqual([])
  })
})

describe("auth_revalidation_status row lifecycle", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it("ensureAuthRevalidationRow creates an unchecked row", () => {
    ensureAuthRevalidationRow(db, "entra", "oid-1", { email: "a@x.com", displayName: "Alice" })
    const row = getAuthRevalidationStatus(db, "entra", "oid-1")
    expect(row).toMatchObject({
      provider: "entra",
      externalId: "oid-1",
      status: "ok",
      lastCheckedAt: null,
      email: "a@x.com",
      displayName: "Alice",
    })
  })

  it("ensureAuthRevalidationRow is idempotent and refreshes identity without touching status", () => {
    ensureAuthRevalidationRow(db, "entra", "oid-1", { email: "a@x.com", displayName: "Alice" })
    db.prepare("UPDATE auth_revalidation_status SET status = 'revoked' WHERE external_id = 'oid-1'").run()
    ensureAuthRevalidationRow(db, "entra", "oid-1", { email: "a2@x.com", displayName: "Alice 2" })
    const row = getAuthRevalidationStatus(db, "entra", "oid-1")
    expect(row?.status).toBe("revoked")
    expect(row?.email).toBe("a2@x.com")
  })

  it("revokeAuthRevalidation flips status and returns true when the row exists", () => {
    ensureAuthRevalidationRow(db, "entra", "oid-1", {})
    expect(revokeAuthRevalidation(db, "entra", "oid-1")).toBe(true)
    expect(getAuthRevalidationStatus(db, "entra", "oid-1")?.status).toBe("revoked")
  })

  it("revokeAuthRevalidation returns false for an unknown row", () => {
    expect(revokeAuthRevalidation(db, "entra", "no-such-oid")).toBe(false)
  })

  it("listAuthRevalidationStatuses scopes by provider", () => {
    ensureAuthRevalidationRow(db, "entra", "oid-1", {})
    ensureAuthRevalidationRow(db, "entra", "oid-2", {})
    expect(listAuthRevalidationStatuses(db, "entra")).toHaveLength(2)
  })
})

describe("shouldPollAuthRevalidation gate", () => {
  let db: Database.Database
  const HOUR = 3_600_000

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it("true when never polled before", () => {
    expect(shouldPollAuthRevalidation(db, Date.now())).toBe(true)
  })

  it("false within an hour of the last poll", () => {
    const now = 100 * HOUR
    db.prepare("INSERT INTO system_config (key, value) VALUES ('entra_revalidation_last_poll_at', ?)").run(
      String(now - 10 * 60_000),
    )
    expect(shouldPollAuthRevalidation(db, now)).toBe(false)
  })

  it("true again once an hour has passed", () => {
    const now = 100 * HOUR
    db.prepare("INSERT INTO system_config (key, value) VALUES ('entra_revalidation_last_poll_at', ?)").run(
      String(now - HOUR - 1),
    )
    expect(shouldPollAuthRevalidation(db, now)).toBe(true)
  })
})

describe("pollEntraRevalidation", () => {
  let db: Database.Database
  const originalEnv = { ...process.env }

  beforeEach(() => {
    db = createTestDb()
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "client-id"
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = "client-secret"
    process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID = "tenant-id"
    __resetAppOnlyGraphTokenCacheForTests()
    __setAppOnlyGraphTokenAdapterForTests(null)
  })

  afterEach(() => {
    Object.keys(process.env).forEach(k => delete process.env[k])
    Object.assign(process.env, originalEnv)
    __setAppOnlyGraphTokenAdapterForTests(null)
    __resetAppOnlyGraphTokenCacheForTests()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    db.close()
  })

  it("no-ops (and doesn't touch rows) when the hourly gate hasn't elapsed", async () => {
    ensureAuthRevalidationRow(db, "entra", "oid-1", {})
    db.prepare("INSERT INTO system_config (key, value) VALUES ('entra_revalidation_last_poll_at', ?)").run(
      String(Date.now()),
    )
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const result = await pollEntraRevalidation(db)
    expect(result).toEqual({ checked: 0, errors: [], revokedExternalIds: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("marks a disabled Graph account as revoked via an injected token adapter", async () => {
    ensureAuthRevalidationRow(db, "entra", "oid-1", {})
    __setAppOnlyGraphTokenAdapterForTests({
      getToken: async () => "fake-token",
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/oauth2/")) {
        throw new Error("token endpoint must not be called when adapter is injected")
      }
      if (url.includes("/users/") && url.includes("accountEnabled")) {
        return { ok: true, status: 200, json: async () => ({ accountEnabled: false }) }
      }
      if (url.includes("/memberOf")) {
        return { ok: true, status: 200, json: async () => ({ value: [] }) }
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await pollEntraRevalidation(db)
    expect(result.checked).toBe(1)
    expect(result.revokedExternalIds).toEqual(["oid-1"])
    expect(getAuthRevalidationStatus(db, "entra", "oid-1")?.status).toBe("revoked")
  })

  it("marks a disabled Graph account as revoked", async () => {
    ensureAuthRevalidationRow(db, "entra", "oid-1", {})
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "t", expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accountEnabled: false }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ value: [] }) })
    vi.stubGlobal("fetch", fetchMock)

    const result = await pollEntraRevalidation(db)
    expect(result.checked).toBe(1)
    expect(result.errors).toEqual([])
    expect(result.revokedExternalIds).toEqual(["oid-1"])
    expect(getAuthRevalidationStatus(db, "entra", "oid-1")?.status).toBe("revoked")
  })

  it("treats a 404 (deleted user) as revoked", async () => {
    ensureAuthRevalidationRow(db, "entra", "oid-1", {})
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "t", expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: false, status: 404 })
    vi.stubGlobal("fetch", fetchMock)

    const result = await pollEntraRevalidation(db)
    expect(result.checked).toBe(1)
    expect(result.revokedExternalIds).toEqual(["oid-1"])
    expect(getAuthRevalidationStatus(db, "entra", "oid-1")?.status).toBe("revoked")
  })

  it("keeps an enabled account 'ok' and stamps last_checked_at", async () => {
    ensureAuthRevalidationRow(db, "entra", "oid-1", {})
    const before = getAuthRevalidationStatus(db, "entra", "oid-1")
    expect(before?.lastCheckedAt).toBeNull()

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "t", expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accountEnabled: true }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ value: [{ id: "group-1" }] }) })
    vi.stubGlobal("fetch", fetchMock)

    await pollEntraRevalidation(db)
    const after = getAuthRevalidationStatus(db, "entra", "oid-1")
    expect(after?.status).toBe("ok")
    expect(after?.lastCheckedAt).not.toBeNull()
    expect(after?.groups).toEqual(["group-1"])
  })

  it("fail-open: a per-user Graph error leaves that row untouched and is reported, not thrown", async () => {
    ensureAuthRevalidationRow(db, "entra", "oid-1", {})
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "t", expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" })
    vi.stubGlobal("fetch", fetchMock)

    const result = await pollEntraRevalidation(db)
    expect(result.checked).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("oid-1")
    // Row untouched — still ok, still unchecked — so a live session isn't affected.
    const row = getAuthRevalidationStatus(db, "entra", "oid-1")
    expect(row?.status).toBe("ok")
    expect(row?.lastCheckedAt).toBeNull()
  })

  it("skips already-revoked rows", async () => {
    ensureAuthRevalidationRow(db, "entra", "oid-1", {})
    revokeAuthRevalidation(db, "entra", "oid-1")
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const result = await pollEntraRevalidation(db)
    expect(result.checked).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("no-ops without throwing when Entra Graph creds are not configured (feature not enabled)", async () => {
    delete process.env.AUTH_MICROSOFT_ENTRA_ID_ID
    ensureAuthRevalidationRow(db, "entra", "oid-1", {})
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const result = await pollEntraRevalidation(db)
    expect(result).toEqual({ checked: 0, errors: [], revokedExternalIds: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
