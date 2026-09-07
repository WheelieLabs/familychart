import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, describe, expect, it } from "vitest"
import { ensureManagedAdmin } from "@/lib/create-managed-admin"

function openTempDb(): { db: Database.Database; filePath: string } {
  const filePath = path.join(
    os.tmpdir(),
    `fc-create-admin-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  )
  const db = new Database(filePath)
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
      must_reset_password  INTEGER NOT NULL DEFAULT 0,
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
      account_uid TEXT
    );
  `)
  return { db, filePath }
}

describe("ensureManagedAdmin", () => {
  const cleanup: string[] = []

  afterEach(() => {
    for (const f of cleanup.splice(0)) {
      try {
        fs.unlinkSync(f)
      } catch {
        /* already gone */
      }
    }
  })

  it("creates the admin row with the forced-reset flag set", () => {
    const { db, filePath } = openTempDb()
    cleanup.push(filePath)

    const result = ensureManagedAdmin(db, " admin@example.com ", "hash-1")
    expect(result).toEqual({ ok: true, userId: 1, created: true, mustResetPassword: true })

    const row = db
      .prepare("SELECT email, password_hash, role, can_report, must_reset_password FROM accounts WHERE id = 1")
      .get() as {
      email: string
      password_hash: string
      role: string
      can_report: number
      must_reset_password: number
    }
    expect(row).toEqual({
      email: "admin@example.com",
      password_hash: "hash-1",
      role: "admin",
      can_report: 0,
      must_reset_password: 1,
    })
    db.close()
  })

  it("is idempotent for the same email and does not change the password hash", () => {
    const { db, filePath } = openTempDb()
    cleanup.push(filePath)

    const first = ensureManagedAdmin(db, "admin@example.com", "hash-1")
    const second = ensureManagedAdmin(db, "admin@example.com", "hash-2")
    expect(first).toEqual({ ok: true, userId: 1, created: true, mustResetPassword: true })
    expect(second).toEqual({ ok: true, userId: 1, created: false, mustResetPassword: true })

    const count = db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }
    expect(count.n).toBe(1)
    const row = db.prepare("SELECT password_hash FROM accounts WHERE id = 1").get() as { password_hash: string }
    expect(row.password_hash).toBe("hash-1")
    db.close()
  })

  it("reports mustResetPassword false once the flag has been cleared", () => {
    const { db, filePath } = openTempDb()
    cleanup.push(filePath)

    ensureManagedAdmin(db, "admin@example.com", "hash-1")
    db.prepare("UPDATE accounts SET must_reset_password = 0 WHERE id = 1").run()
    const again = ensureManagedAdmin(db, "admin@example.com", "hash-2")
    expect(again).toEqual({ ok: true, userId: 1, created: false, mustResetPassword: false })
    db.close()
  })

  it("refuses when a different local account already exists", () => {
    const { db, filePath } = openTempDb()
    cleanup.push(filePath)

    ensureManagedAdmin(db, "admin@example.com", "hash-1")
    const result = ensureManagedAdmin(db, "other@example.com", "hash-2")
    expect(result).toEqual({ ok: false, error: "A local account already exists with a different email" })
    db.close()
  })

  it("still succeeds when only an Entra auto-create bookkeeping row exists on the tenant", () => {
    const { db, filePath } = openTempDb()
    cleanup.push(filePath)

    // lib/account-entra-match.ts auto-creates an accounts row for any Entra sign-in, admin
    // or not — this must not block seeding the managed admin on an otherwise-empty tenant.
    db.prepare(
      "INSERT INTO accounts (email, role, auth_method, external_id, status) VALUES ('someone@example.com', 'read', 'entra', 'oid-1', 'active')",
    ).run()

    const result = ensureManagedAdmin(db, "admin@example.com", "hash-1")
    expect(result).toEqual({ ok: true, userId: 2, created: true, mustResetPassword: true })
    db.close()
  })

  it("rejects a case-varied duplicate of an existing Entra bookkeeping row's email", () => {
    // lib/account-entra-match.ts always lowercases the email it stores; the managed-admin
    // seed email must still be caught as taken even if it differs only in casing.
    const { db, filePath } = openTempDb()
    cleanup.push(filePath)

    db.prepare(
      "INSERT INTO accounts (email, role, auth_method, external_id, status) VALUES ('admin@example.com', 'read', 'entra', 'oid-1', 'active')",
    ).run()

    const result = ensureManagedAdmin(db, "Admin@Example.com", "hash-1")
    expect(result).toEqual({ ok: false, error: "This email is already in use by a different account" })
    db.close()
  })

  it("does not mistake an Entra bookkeeping row with the seed email for the already-created managed admin", () => {
    const { db, filePath } = openTempDb()
    cleanup.push(filePath)

    // Same email as the managed-admin seed, but auth_method='entra' — this must not be
    // reported as "the admin already exists" (ok:true, created:false) with no real
    // credential ever created.
    db.prepare(
      "INSERT INTO accounts (email, role, auth_method, external_id, status) VALUES ('admin@example.com', 'read', 'entra', 'oid-1', 'active')",
    ).run()

    const result = ensureManagedAdmin(db, "admin@example.com", "hash-1")
    expect(result).toEqual({ ok: false, error: "This email is already in use by a different account" })
    db.close()
  })

  it("requires email and passwordHash", () => {
    const { db, filePath } = openTempDb()
    cleanup.push(filePath)

    expect(ensureManagedAdmin(db, "  ", "hash").ok).toBe(false)
    expect(ensureManagedAdmin(db, "admin@example.com", "").ok).toBe(false)
    db.close()
  })
})
