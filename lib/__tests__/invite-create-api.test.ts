// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { sendOutboundEmail } from "@/lib/email-send"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/db")>()
  return { ...actual, getDb: () => testDb }
})

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => sessionOverride),
}))

vi.mock("@/lib/email-send", () => ({
  isOutboundEmailConfigured: vi.fn(() => emailConfigured),
  sendOutboundEmail: vi.fn(async () => sendResult),
}))

let testDb: Database.Database
let sessionOverride: { user: { id: string; email: string }; sessionVersion: number } | null
let emailConfigured: boolean
let sendResult: { ok: true } | { ok: false; error: string }

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE accounts (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      email                TEXT NOT NULL UNIQUE,
      password_hash        TEXT,
      role                 TEXT NOT NULL DEFAULT 'write',
      is_active            INTEGER NOT NULL DEFAULT 1,
      can_report           INTEGER NOT NULL DEFAULT 0,
      totp_secret          TEXT,
      totp_secret_pending  TEXT,
      session_version      INTEGER NOT NULL DEFAULT 0,
      auth_method          TEXT NOT NULL DEFAULT 'local',
      external_id          TEXT,
      status               TEXT NOT NULL DEFAULT 'active',
      invite_token_hash    TEXT,
      invite_expires_at    DATETIME,
      invite_revoked_at    DATETIME,
      created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE people (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      account_uid   TEXT,
      is_active     INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX idx_people_account_uid_unique
      ON people(account_uid) WHERE account_uid IS NOT NULL;
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
  db.prepare(
    "INSERT INTO accounts (id, email, password_hash, role, is_active, session_version) VALUES (1, 'admin@example.com', 'h', 'admin', 1, 0)",
  ).run()
  return db
}

async function postInvite(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/accounts/invites/route")
  const req = new NextRequest("http://localhost/api/accounts/invites", {
    method: "POST",
    body: JSON.stringify(body),
  })
  return POST(req)
}

async function getInvites() {
  const { GET } = await import("@/app/api/accounts/invites/route")
  return GET()
}

describe("POST /api/accounts/invites", () => {
  beforeEach(() => {
    testDb = createTestDb()
    sessionOverride = { user: { id: "local:1", email: "admin@example.com" }, sessionVersion: 0 }
    emailConfigured = true
    sendResult = { ok: true }
    vi.mocked(sendOutboundEmail).mockClear()
  })

  afterEach(() => {
    testDb.close()
  })

  it("creates a pending invite with no person link", async () => {
    const res = await postInvite({ email: "new@example.com", role: "write", personAction: "none" })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { account: { id: number; email: string; status: string } }
    expect(body.account.email).toBe("new@example.com")
    expect(body.account.status).toBe("invited")

    expect(sendOutboundEmail).toHaveBeenCalledTimes(1)
    expect(sendOutboundEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: "new@example.com",
        subject: "You've been invited to FamilyChart",
        text: expect.any(String),
        html: expect.any(String),
      }),
    )

    const row = testDb.prepare("SELECT auth_method, invite_token_hash, invite_expires_at FROM accounts WHERE email = ?").get("new@example.com") as {
      auth_method: string
      invite_token_hash: string
      invite_expires_at: string
    }
    expect(row.auth_method).toBe("local")
    expect(row.invite_token_hash).toBeTruthy()
    expect(row.invite_expires_at).toBeTruthy()

    const audit = testDb.prepare("SELECT action, entity_type FROM audit_log").get() as {
      action: string
      entity_type: string
    }
    expect(audit).toEqual({ action: "CREATE", entity_type: "accounts" })
  })

  it("creates a new Person and links it immediately", async () => {
    const res = await postInvite({
      email: "new@example.com",
      role: "read",
      personAction: "create",
      personName: "Alex",
    })
    expect(res.status).toBe(201)

    const account = testDb.prepare("SELECT id FROM accounts WHERE email = ?").get("new@example.com") as { id: number }
    const person = testDb.prepare("SELECT name, account_uid FROM people WHERE name = 'Alex'").get() as {
      name: string
      account_uid: string
    }
    expect(person.account_uid).toBe(`local:${account.id}`)
  })

  it("links an existing unlinked Person immediately", async () => {
    testDb.prepare("INSERT INTO people (id, name, account_uid) VALUES (5, 'Existing', NULL)").run()

    const res = await postInvite({
      email: "new@example.com",
      role: "read",
      personAction: "link",
      personId: 5,
    })
    expect(res.status).toBe(201)

    const account = testDb.prepare("SELECT id FROM accounts WHERE email = ?").get("new@example.com") as { id: number }
    const person = testDb.prepare("SELECT account_uid FROM people WHERE id = 5").get() as { account_uid: string }
    expect(person.account_uid).toBe(`local:${account.id}`)
  })

  it("rejects linking a Person that already has an Account", async () => {
    testDb.prepare("INSERT INTO people (id, name, account_uid) VALUES (5, 'Existing', 'local:1')").run()

    const res = await postInvite({
      email: "new@example.com",
      role: "read",
      personAction: "link",
      personId: 5,
    })
    expect(res.status).toBe(409)
  })

  it("rejects the link, rolling back the just-inserted invite row, when the person's account_uid " +
    "is no longer NULL by the time the UPDATE runs (defence-in-depth re-check inside the transaction — " +
    "the pre-check above is not itself concurrency-safe against a differently-shaped future change)", async () => {
    testDb.prepare("INSERT INTO people (id, name, account_uid) VALUES (5, 'Existing', NULL)").run()
    const originalPrepare = testDb.prepare.bind(testDb)
    let armed = true
    vi.spyOn(testDb, "prepare").mockImplementation(((sql: string) => {
      if (armed && sql.includes("INSERT INTO accounts (email, role, status")) {
        armed = false
        originalPrepare("UPDATE people SET account_uid = 'local:999' WHERE id = 5").run()
      }
      return originalPrepare(sql)
    }) as typeof testDb.prepare)

    const res = await postInvite({ email: "new@example.com", role: "read", personAction: "link", personId: 5 })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe("This Person already has a linked Account")

    // Everything rolls back together, including the synthetic mid-transaction update above —
    // the account row must not be left orphaned.
    const account = testDb.prepare("SELECT id FROM accounts WHERE email = 'new@example.com'").get()
    expect(account).toBeUndefined()
  })

  it("rejects a duplicate email", async () => {
    const res = await postInvite({ email: "admin@example.com", role: "write", personAction: "none" })
    expect(res.status).toBe(409)
  })

  it("rejects a duplicate email that only differs in case from a pre-existing row " +
    "(e.g. one created via /api/local-users, which doesn't lowercase)", async () => {
    testDb.prepare("INSERT INTO accounts (email, role) VALUES ('Mixed@Example.com', 'write')").run()
    const res = await postInvite({ email: "mixed@example.com", role: "write", personAction: "none" })
    expect(res.status).toBe(409)
  })

  it("reports 'Email already exists' — not a Person-link conflict — when accounts.email's unique constraint " +
    "fires inside the transaction (e.g. a same-email invite racing the pre-check)", async () => {
    const originalPrepare = testDb.prepare.bind(testDb)
    vi.spyOn(testDb, "prepare").mockImplementation(((sql: string) => {
      if (sql.includes("INSERT INTO accounts (email")) {
        return {
          run: () => {
            const err = new Error("UNIQUE constraint failed: accounts.email") as Error & { code: string }
            err.code = "SQLITE_CONSTRAINT_UNIQUE"
            throw err
          },
        }
      }
      return originalPrepare(sql)
    }) as typeof testDb.prepare)

    const res = await postInvite({ email: "race@example.com", role: "write", personAction: "none" })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe("Email already exists")
  })

  it("rejects an invalid role", async () => {
    const res = await postInvite({ email: "new@example.com", role: "superadmin", personAction: "none" })
    expect(res.status).toBe(400)
  })

  it("rejects when outbound email is not configured", async () => {
    emailConfigured = false
    const res = await postInvite({ email: "new@example.com", role: "write", personAction: "none" })
    expect(res.status).toBe(400)
  })

  it("keeps the invite row and reports the error when delivery fails", async () => {
    sendResult = { ok: false, error: "SMTP is not fully configured" }
    const res = await postInvite({ email: "new@example.com", role: "write", personAction: "none" })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { account: { status: string }; emailError?: string }
    expect(body.account.status).toBe("invited")
    expect(body.emailError).toBe("SMTP is not fully configured")
  })

  it("rejects a non-admin session", async () => {
    testDb.prepare("UPDATE accounts SET role = 'write' WHERE id = 1").run()
    const res = await postInvite({ email: "new@example.com", role: "write", personAction: "none" })
    expect(res.status).toBe(403)
  })
})

describe("GET /api/accounts/invites", () => {
  beforeEach(() => {
    testDb = createTestDb()
    sessionOverride = { user: { id: "local:1", email: "admin@example.com" }, sessionVersion: 0 }
  })

  afterEach(() => {
    testDb.close()
  })

  it("marks a live pending invite as linkable and a dead one as not", async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60).toISOString()
    const past = new Date(Date.now() - 1000 * 60 * 60).toISOString()
    testDb.prepare(
      "INSERT INTO accounts (email, status, invite_expires_at) VALUES ('live@example.com', 'invited', ?)",
    ).run(future)
    testDb.prepare(
      "INSERT INTO accounts (email, status, invite_expires_at) VALUES ('dead@example.com', 'invited', ?)",
    ).run(past)

    const res = await getInvites()
    expect(res.status).toBe(200)
    const rows = (await res.json()) as { email: string; linkable: number }[]
    const live = rows.find(r => r.email === "live@example.com")
    const dead = rows.find(r => r.email === "dead@example.com")
    const admin = rows.find(r => r.email === "admin@example.com")
    expect(live?.linkable).toBe(1)
    expect(dead?.linkable).toBe(0)
    expect(admin?.linkable).toBe(1)
  })
})
