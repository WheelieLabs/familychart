// SPDX-License-Identifier: AGPL-3.0-only

import crypto from "node:crypto"
import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  accountInviteDisplayStatus,
  claimInviteForEntra,
  commitInviteResend,
  createInvite,
  isDeadInviteAccountUid,
  listInvitesForAdmin,
  prepareInviteResend,
  redeemInvite,
  resolveInviterDisplay,
  revokeInvite,
  verifyInviteToken,
} from "@/lib/invite"

const NOW = Date.parse("2026-08-31T00:00:00.000Z")
const FUTURE = "2026-09-07T00:00:00.000Z"
const PAST = "2026-08-24T00:00:00.000Z"
const ORIGIN = "http://localhost"

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
      auth_method          TEXT NOT NULL DEFAULT 'local',
      external_id          TEXT,
      status               TEXT NOT NULL DEFAULT 'active',
      invite_token_hash    TEXT,
      invite_expires_at    DATETIME,
      invite_revoked_at    DATETIME,
      created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE people (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      account_uid TEXT,
      is_active   INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX idx_people_account_uid_unique
      ON people(account_uid) WHERE account_uid IS NOT NULL;
  `)
  return db
}

/** A test-minted token/hash pair, independent of the module's private mint — verifyInviteToken
 * and redeemInvite only need a valid sha256 lookup, not real production randomness. */
function mintTestToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(16).toString("hex")
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex")
  return { token, tokenHash }
}

function insertInvitedAccount(
  db: Database.Database,
  opts: { email: string; tokenHash: string; expiresAt: string; revokedAt?: string | null },
): number {
  const result = db
    .prepare(
      `INSERT INTO accounts (email, status, invite_token_hash, invite_expires_at, invite_revoked_at)
       VALUES (?, 'invited', ?, ?, ?)`,
    )
    .run(opts.email, opts.tokenHash, opts.expiresAt, opts.revokedAt ?? null)
  return Number(result.lastInsertRowid)
}

describe("accountInviteDisplayStatus", () => {
  it("returns active for a claimed account", () => {
    expect(
      accountInviteDisplayStatus({ status: "active", invite_expires_at: null, invite_revoked_at: null }, NOW),
    ).toBe("active")
  })

  it("returns invited for a live pending invite", () => {
    expect(
      accountInviteDisplayStatus({ status: "invited", invite_expires_at: FUTURE, invite_revoked_at: null }, NOW),
    ).toBe("invited")
  })

  it("returns expired when the invite has lapsed and was not revoked", () => {
    expect(
      accountInviteDisplayStatus({ status: "invited", invite_expires_at: PAST, invite_revoked_at: null }, NOW),
    ).toBe("expired")
  })

  it("returns revoked when invite_revoked_at is set, even if expiry has also passed", () => {
    expect(
      accountInviteDisplayStatus({ status: "invited", invite_expires_at: PAST, invite_revoked_at: PAST }, NOW),
    ).toBe("revoked")
  })
})

describe("isDeadInviteAccountUid", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it("is false for a live pending invite", () => {
    const id = insertInvitedAccount(db, { email: "a@example.com", tokenHash: "h", expiresAt: new Date(NOW + 60_000).toISOString() })
    expect(isDeadInviteAccountUid(db, `local:${id}`, NOW)).toBe(false)
  })

  it("is true for an expired invite", () => {
    const id = insertInvitedAccount(db, { email: "a@example.com", tokenHash: "h", expiresAt: new Date(NOW - 1000).toISOString() })
    expect(isDeadInviteAccountUid(db, `local:${id}`, NOW)).toBe(true)
  })

  it("is true for an invited row with no expiry at all — matches the list's linkable computation, " +
    "which also treats a NULL invite_expires_at as dead", () => {
    const result = db
      .prepare("INSERT INTO accounts (email, status) VALUES ('no-expiry@example.com', 'invited')")
      .run()
    expect(isDeadInviteAccountUid(db, `local:${Number(result.lastInsertRowid)}`, NOW)).toBe(true)
  })

  it("is true for a revoked invite", () => {
    const id = insertInvitedAccount(db, {
      email: "a@example.com",
      tokenHash: "h",
      expiresAt: new Date(NOW + 60_000).toISOString(),
      revokedAt: new Date(NOW - 1000).toISOString(),
    })
    expect(isDeadInviteAccountUid(db, `local:${id}`, NOW)).toBe(true)
  })

  it("is false for an already-active account, even one that was never given an expiry", () => {
    const result = db.prepare("INSERT INTO accounts (email, status) VALUES ('active@example.com', 'active')").run()
    expect(isDeadInviteAccountUid(db, `local:${Number(result.lastInsertRowid)}`, NOW)).toBe(false)
  })

  it("is false for a raw (non-local:) uid, a missing account, or null", () => {
    expect(isDeadInviteAccountUid(db, "some-entra-oid", NOW)).toBe(false)
    expect(isDeadInviteAccountUid(db, "local:999", NOW)).toBe(false)
    expect(isDeadInviteAccountUid(db, null, NOW)).toBe(false)
  })
})

describe("listInvitesForAdmin", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it("marks a live pending invite as linkable and a dead one as not, active as always linkable", () => {
    insertInvitedAccount(db, { email: "live@example.com", tokenHash: "h1", expiresAt: new Date(NOW + 60_000).toISOString() })
    insertInvitedAccount(db, { email: "dead@example.com", tokenHash: "h2", expiresAt: new Date(NOW - 60_000).toISOString() })
    db.prepare("INSERT INTO accounts (email, status) VALUES ('admin@example.com', 'active')").run()

    const rows = listInvitesForAdmin(db, NOW)
    expect(rows.find(r => r.email === "live@example.com")?.linkable).toBe(1)
    expect(rows.find(r => r.email === "dead@example.com")?.linkable).toBe(0)
    expect(rows.find(r => r.email === "admin@example.com")?.linkable).toBe(1)
  })
})

describe("createInvite", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    db.prepare("INSERT INTO accounts (email, status) VALUES ('taken@example.com', 'active')").run()
  })

  afterEach(() => {
    db.close()
  })

  it("denies email_taken", () => {
    const result = createInvite(
      db,
      { email: "taken@example.com", role: "write", personAction: "none" },
      { origin: ORIGIN, inviter: {} },
    )
    expect(result).toEqual({ ok: false, reason: "email_taken" })
  })

  it("denies person_not_found when linking a missing Person", () => {
    const result = createInvite(
      db,
      { email: "new@example.com", role: "read", personAction: "link", personId: 999 },
      { origin: ORIGIN, inviter: {} },
    )
    expect(result).toEqual({ ok: false, reason: "person_not_found" })
  })

  it("denies person_already_linked when the target Person already has an account_uid", () => {
    db.prepare("INSERT INTO people (id, name, account_uid) VALUES (5, 'Existing', 'local:1')").run()
    const result = createInvite(
      db,
      { email: "new@example.com", role: "read", personAction: "link", personId: 5 },
      { origin: ORIGIN, inviter: {} },
    )
    expect(result).toEqual({ ok: false, reason: "person_already_linked" })
  })

  it("creates a pending invite, links an existing Person, and returns mail fields (name-branch inviter) plus a usable token", () => {
    db.prepare("INSERT INTO people (id, name, account_uid) VALUES (5, 'Existing', NULL)").run()
    // Inviting admin (account 1, local) is Personal-linked to 'Ben' — exercises the
    // Personal-link-name branch of resolveInviterDisplay.
    db.prepare("INSERT INTO people (id, name, account_uid) VALUES (6, 'Ben', 'local:1')").run()
    const result = createInvite(
      db,
      { email: "new@example.com", role: "read", personAction: "link", personId: 5 },
      { origin: ORIGIN, inviter: { id: "local:1", email: "ben@example.com" }, nowMs: NOW },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.account.email).toBe("new@example.com")
    expect(result.account.status).toBe("invited")
    expect(result.mail).toEqual({
      to: "new@example.com",
      subject: "You've been invited to FamilyChart",
      text: expect.stringContaining(result.token),
      html: expect.stringContaining(result.token),
    })
    expect(result.mail.text).toContain("Ben has invited you to join their family's FamilyChart instance.")
    expect(result.mail.text).toContain("This link expires in 7 days and can only be used once.")
    expect(result.mail.html).toContain("<strong>Ben</strong> has invited you")

    const person = db.prepare("SELECT account_uid FROM people WHERE id = 5").get() as { account_uid: string }
    expect(person.account_uid).toBe(`local:${result.account.id}`)

    expect(verifyInviteToken(db, result.token, NOW)).toEqual({ valid: true, accountId: result.account.id })
  })

  it("falls back to the inviter's email when they have no Personal-link or Entra profile name", () => {
    const result = createInvite(
      db,
      { email: "new2@example.com", role: "read", personAction: "none" },
      { origin: ORIGIN, inviter: { id: "local:1", email: "ben@example.com" }, nowMs: NOW },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mail.text).toContain("You've been invited by ben@example.com to join a FamilyChart instance.")
    expect(result.mail.html).toContain("You've been invited by <strong>ben@example.com</strong>")
  })

  it("creates and links a brand-new Person", () => {
    const result = createInvite(
      db,
      { email: "new@example.com", role: "read", personAction: "create", personName: "Alex" },
      { origin: ORIGIN, inviter: {} },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const person = db.prepare("SELECT name, account_uid FROM people WHERE name = 'Alex'").get() as {
      name: string
      account_uid: string
    }
    expect(person.account_uid).toBe(`local:${result.account.id}`)
  })
})

describe("resolveInviterDisplay", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it("prefers the inviter's Personal-linked Person name over everything else", () => {
    db.prepare("INSERT INTO people (id, name, account_uid) VALUES (1, 'Ben', 'local:1')").run()
    const display = resolveInviterDisplay(db, { id: "local:1", email: "ben@example.com", name: "Should Not Win", entraOid: "oid-1" })
    expect(display).toEqual({ kind: "name", value: "Ben" })
  })

  it("falls back to the Entra profile name when there's no Personal-link", () => {
    const display = resolveInviterDisplay(db, { id: "entra-oid-1", email: "ben@example.com", name: "Ben Entra", entraOid: "entra-oid-1" })
    expect(display).toEqual({ kind: "name", value: "Ben Entra" })
  })

  it("ignores a session name when there's no entraOid (local sign-in never has a real name)", () => {
    const display = resolveInviterDisplay(db, { id: "local:1", email: "ben@example.com", name: "Stray Name" })
    expect(display).toEqual({ kind: "email", value: "ben@example.com" })
  })

  it("falls back to email when there's no Personal-link and no Entra profile name", () => {
    const display = resolveInviterDisplay(db, { id: "local:1", email: "ben@example.com" })
    expect(display).toEqual({ kind: "email", value: "ben@example.com" })
  })

  it("ignores an inactive Personal-link and falls through to email", () => {
    db.prepare("INSERT INTO people (id, name, account_uid, is_active) VALUES (1, 'Ben', 'local:1', 0)").run()
    const display = resolveInviterDisplay(db, { id: "local:1", email: "ben@example.com" })
    expect(display).toEqual({ kind: "email", value: "ben@example.com" })
  })
})

describe("resend + revoke", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it("prepareInviteResend denies not_pending for an already-active account", () => {
    const result = db.prepare("INSERT INTO accounts (email, status) VALUES ('a@example.com', 'active')").run()
    const prep = prepareInviteResend(db, Number(result.lastInsertRowid), { origin: ORIGIN, inviter: {} })
    expect(prep).toEqual({ ok: false, reason: "not_pending" })
  })

  it("prepare+commit mints a fresh token, extends expiry, and clears revoked_at without persisting until commit", () => {
    const id = insertInvitedAccount(db, {
      email: "invitee@example.com",
      tokenHash: "oldhash",
      expiresAt: new Date(NOW - 1000).toISOString(),
      revokedAt: new Date(NOW - 1000).toISOString(),
    })

    const prep = prepareInviteResend(db, id, { origin: ORIGIN, inviter: {}, nowMs: NOW })
    expect(prep.ok).toBe(true)
    if (!prep.ok) return

    // Not persisted yet.
    const beforeCommit = db.prepare("SELECT invite_token_hash FROM accounts WHERE id = ?").get(id) as {
      invite_token_hash: string
    }
    expect(beforeCommit.invite_token_hash).toBe("oldhash")

    commitInviteResend(db, prep.draft)

    const row = db
      .prepare("SELECT invite_token_hash, invite_expires_at, invite_revoked_at FROM accounts WHERE id = ?")
      .get(id) as { invite_token_hash: string; invite_expires_at: string; invite_revoked_at: string | null }
    expect(row.invite_token_hash).toBe(prep.draft.tokenHash)
    expect(row.invite_token_hash).not.toBe("oldhash")
    expect(new Date(row.invite_expires_at).getTime()).toBeGreaterThan(NOW)
    expect(row.invite_revoked_at).toBeNull()
  })

  it("revokeInvite returns false for an already-active or already-revoked account", () => {
    const active = db.prepare("INSERT INTO accounts (email, status) VALUES ('a@example.com', 'active')").run()
    expect(revokeInvite(db, Number(active.lastInsertRowid), NOW)).toBe(false)

    const revoked = insertInvitedAccount(db, {
      email: "b@example.com",
      tokenHash: "h",
      expiresAt: new Date(NOW + 60_000).toISOString(),
      revokedAt: new Date(NOW - 1000).toISOString(),
    })
    expect(revokeInvite(db, revoked, NOW)).toBe(false)
  })

  it("revokeInvite sets invite_revoked_at and leaves role/person link untouched", () => {
    const id = insertInvitedAccount(db, { email: "a@example.com", tokenHash: "h", expiresAt: new Date(NOW + 60_000).toISOString() })
    db.prepare("UPDATE accounts SET role = 'manage' WHERE id = ?").run(id)
    db.prepare("INSERT INTO people (name, account_uid) VALUES ('Alex', ?)").run(`local:${id}`)

    expect(revokeInvite(db, id, NOW)).toBe(true)

    const row = db.prepare("SELECT role, invite_revoked_at FROM accounts WHERE id = ?").get(id) as {
      role: string
      invite_revoked_at: string | null
    }
    expect(row.role).toBe("manage")
    expect(row.invite_revoked_at).toBeTruthy()
    const person = db.prepare("SELECT account_uid FROM people WHERE account_uid = ?").get(`local:${id}`)
    expect(person).toBeTruthy()
  })
})

describe("verifyInviteToken / redeemInvite", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it("verifies a live pending invite and rejects an unknown, expired, revoked, or already-active one", () => {
    const { token, tokenHash } = mintTestToken()
    const accountId = insertInvitedAccount(db, { email: "a@example.com", tokenHash, expiresAt: new Date(NOW + 1000).toISOString() })
    expect(verifyInviteToken(db, token, NOW)).toEqual({ valid: true, accountId })
    expect(verifyInviteToken(db, "not-a-real-token", NOW)).toEqual({ valid: false })
    expect(verifyInviteToken(db, "", NOW)).toEqual({ valid: false })

    const expired = mintTestToken()
    insertInvitedAccount(db, { email: "b@example.com", tokenHash: expired.tokenHash, expiresAt: new Date(NOW - 1000).toISOString() })
    expect(verifyInviteToken(db, expired.token, NOW)).toEqual({ valid: false })

    const revoked = mintTestToken()
    insertInvitedAccount(db, {
      email: "c@example.com",
      tokenHash: revoked.tokenHash,
      expiresAt: new Date(NOW + 1000).toISOString(),
      revokedAt: new Date(NOW - 1000).toISOString(),
    })
    expect(verifyInviteToken(db, revoked.token, NOW)).toEqual({ valid: false })
  })

  it("redeemInvite sets the password, flips status to active, clears the token, and cannot be redeemed twice", () => {
    const { token, tokenHash } = mintTestToken()
    const accountId = insertInvitedAccount(db, { email: "a@example.com", tokenHash, expiresAt: new Date(NOW + 1000).toISOString() })

    const first = redeemInvite(db, token, "hash-1", NOW)
    expect(first).toEqual({ ok: true, accountId, email: "a@example.com" })

    const row = db
      .prepare("SELECT password_hash, status, invite_token_hash, invite_expires_at FROM accounts WHERE id = ?")
      .get(accountId) as { password_hash: string; status: string; invite_token_hash: string | null; invite_expires_at: string | null }
    expect(row).toEqual({ password_hash: "hash-1", status: "active", invite_token_hash: null, invite_expires_at: null })

    const second = redeemInvite(db, token, "hash-2", NOW)
    expect(second).toEqual({ ok: false })
    expect((db.prepare("SELECT password_hash FROM accounts WHERE id = ?").get(accountId) as { password_hash: string }).password_hash).toBe("hash-1")
  })

  it("leaves the account untouched for an expired token", () => {
    const { token, tokenHash } = mintTestToken()
    insertInvitedAccount(db, { email: "a@example.com", tokenHash, expiresAt: new Date(NOW - 1000).toISOString() })
    const result = redeemInvite(db, token, "new-hash", NOW)
    expect(result).toEqual({ ok: false })
  })
})

describe("claimInviteForEntra", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it("claims a pending invite by email, flipping status/auth_method and setting external_id", () => {
    const id = insertInvitedAccount(db, { email: "invitee@example.com", tokenHash: "h", expiresAt: new Date(NOW + 60_000).toISOString() })
    const result = claimInviteForEntra(db, { oid: "oid-1", email: "invitee@example.com" })
    expect(result).toEqual({ claimed: true, accountId: id })

    const row = db
      .prepare("SELECT status, auth_method, external_id, invite_token_hash, invite_expires_at FROM accounts WHERE id = ?")
      .get(id) as { status: string; auth_method: string; external_id: string; invite_token_hash: string | null; invite_expires_at: string | null }
    expect(row.status).toBe("active")
    expect(row.auth_method).toBe("entra")
    expect(row.external_id).toBe("oid-1")
    expect(row.invite_token_hash).toBeNull()
    expect(row.invite_expires_at).toBeNull()
  })

  it("repoints a Person linked at invite time from 'local:<id>' to the raw oid", () => {
    const id = insertInvitedAccount(db, { email: "invitee@example.com", tokenHash: "h", expiresAt: new Date(NOW + 60_000).toISOString() })
    db.prepare("INSERT INTO people (id, name, account_uid) VALUES (7, 'Alex', ?)").run(`local:${id}`)

    claimInviteForEntra(db, { oid: "oid-1", email: "invitee@example.com" })

    const person = db.prepare("SELECT account_uid FROM people WHERE id = 7").get() as { account_uid: string }
    expect(person.account_uid).toBe("oid-1")
  })

  it("does not touch an unrelated Person's link when claiming an invite", () => {
    insertInvitedAccount(db, { email: "invitee@example.com", tokenHash: "h", expiresAt: new Date(NOW + 60_000).toISOString() })
    db.prepare("INSERT INTO people (id, name, account_uid) VALUES (8, 'Other', 'local:999')").run()

    claimInviteForEntra(db, { oid: "oid-1", email: "invitee@example.com" })

    const person = db.prepare("SELECT account_uid FROM people WHERE id = 8").get() as { account_uid: string }
    expect(person.account_uid).toBe("local:999")
  })

  it("matches case-insensitively", () => {
    const id = insertInvitedAccount(db, { email: "invitee@example.com", tokenHash: "h", expiresAt: new Date(NOW + 60_000).toISOString() })
    expect(claimInviteForEntra(db, { oid: "oid-1", email: "Invitee@Example.com" })).toEqual({ claimed: true, accountId: id })
  })

  it("still claims an expired invite by email, rather than colliding on the email's unique constraint", () => {
    const id = insertInvitedAccount(db, { email: "expired@example.com", tokenHash: "h", expiresAt: new Date(NOW - 1000).toISOString() })
    expect(claimInviteForEntra(db, { oid: "oid-2", email: "expired@example.com" })).toEqual({ claimed: true, accountId: id })
  })

  it("still claims a revoked invite by email, rather than colliding on the email's unique constraint", () => {
    const id = insertInvitedAccount(db, {
      email: "revoked@example.com",
      tokenHash: "h",
      expiresAt: new Date(NOW + 60_000).toISOString(),
      revokedAt: new Date(NOW - 1000).toISOString(),
    })
    expect(claimInviteForEntra(db, { oid: "oid-3", email: "revoked@example.com" })).toEqual({ claimed: true, accountId: id })
  })

  it("does not claim when there is no matching invited row", () => {
    expect(claimInviteForEntra(db, { oid: "oid-4", email: "nobody@example.com" })).toEqual({ claimed: false })
    expect(claimInviteForEntra(db, { oid: "oid-5", email: null })).toEqual({ claimed: false })
  })

  it("never claims an already-active account, even one matching by email", () => {
    db.prepare("INSERT INTO accounts (email, status, auth_method, password_hash) VALUES ('taken@example.com', 'active', 'local', 'h')").run()
    expect(claimInviteForEntra(db, { oid: "oid-6", email: "taken@example.com" })).toEqual({ claimed: false })
  })
})
