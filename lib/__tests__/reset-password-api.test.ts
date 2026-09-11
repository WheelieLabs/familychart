import crypto from "node:crypto"
import Database from "better-sqlite3-multiple-ciphers"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { deriveResetTokenKey } from "@/lib/reset-token"
import { resetAuthRateLimitForTests } from "@/lib/auth/auth-rate-limit"

const SECRET = "test-nextauth-secret-fixed-vector-000000"
const originalSecret = process.env.NEXTAUTH_SECRET

vi.mock("@/lib/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/db")>()
  return { ...actual, getDb: () => testDb }
})

let testDb: Database.Database

function mintTestToken(userId: string, exp: number, secret: string): string {
  const payload = `${userId}.${exp}`
  const key = deriveResetTokenKey(secret)
  const signature = crypto.createHmac("sha256", key).update(`${payload}.password-reset`).digest()
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${Buffer.from(signature).toString("base64url")}`
}

async function postReset(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/auth/reset-password/route")
  const req = new NextRequest("http://localhost/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(body),
  })
  return POST(req)
}

describe("POST /api/auth/reset-password", () => {
  const FUTURE_EXP = Math.floor(Date.now() / 1000) + 3600
  const PAST_EXP = Math.floor(Date.now() / 1000) - 1

  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = SECRET
    resetAuthRateLimitForTests()
    testDb = new Database(":memory:")
    testDb.exec(`
      CREATE TABLE accounts (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        email                TEXT NOT NULL,
        password_hash        TEXT,
        role                 TEXT NOT NULL,
        is_active            INTEGER NOT NULL DEFAULT 1,
        can_report           INTEGER NOT NULL DEFAULT 0,
        totp_secret          TEXT,
        totp_secret_pending  TEXT,
        session_version      INTEGER NOT NULL DEFAULT 0,
        must_reset_password  INTEGER NOT NULL DEFAULT 0,
        created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE people (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        account_uid TEXT
      );
      CREATE TABLE app_settings (
        key   TEXT UNIQUE NOT NULL,
        value TEXT
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
    testDb
      .prepare(
        "INSERT INTO accounts (id, email, password_hash, role, must_reset_password) VALUES (123, 'admin@example.com', 'old-hash', 'admin', 1)",
      )
      .run()
  })

  afterEach(() => {
    testDb.close()
    if (originalSecret === undefined) delete process.env.NEXTAUTH_SECRET
    else process.env.NEXTAUTH_SECRET = originalSecret
  })

  it("sets the new password, clears the forced-reset flag, and returns the account email to enable auto sign-in", async () => {
    const token = mintTestToken("123", FUTURE_EXP, SECRET)
    const res = await postReset({ token, password: "a-strong-new-password", confirmPassword: "a-strong-new-password" })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; email: string }
    expect(body).toEqual({ ok: true, email: "admin@example.com" })

    const row = testDb.prepare("SELECT password_hash, must_reset_password FROM accounts WHERE id = 123").get() as {
      password_hash: string
      must_reset_password: number
    }
    expect(row.password_hash).not.toBe("old-hash")
    expect(row.must_reset_password).toBe(0)

    const audit = testDb.prepare("SELECT action, entity_type, entity_id FROM audit_log").get() as {
      action: string
      entity_type: string
      entity_id: number
    }
    expect(audit).toEqual({ action: "UPDATE", entity_type: "accounts", entity_id: 123 })
  })

  it("rejects an expired token without changing the password", async () => {
    const token = mintTestToken("123", PAST_EXP, SECRET)
    const res = await postReset({ token, password: "a-strong-new-password", confirmPassword: "a-strong-new-password" })
    expect(res.status).toBe(400)
    const row = testDb.prepare("SELECT password_hash FROM accounts WHERE id = 123").get() as { password_hash: string }
    expect(row.password_hash).toBe("old-hash")
  })

  it("rejects an expired token without paying the bcrypt cost", async () => {
    const bcrypt = await import("bcryptjs")
    const hashSpy = vi.spyOn(bcrypt.default, "hash")
    const token = mintTestToken("123", PAST_EXP, SECRET)
    const res = await postReset({ token, password: "a-strong-new-password", confirmPassword: "a-strong-new-password" })
    expect(res.status).toBe(400)
    expect(hashSpy).not.toHaveBeenCalled()
  })

  it("rejects a tampered token", async () => {
    const token = mintTestToken("123", FUTURE_EXP, SECRET)
    const [payload, sig] = token.split(".")
    const sigBytes = Buffer.from(sig!, "base64url")
    sigBytes[0] = sigBytes[0]! ^ 0xff
    const tampered = `${payload}.${sigBytes.toString("base64url")}`
    const res = await postReset({ token: tampered, password: "a-strong-new-password", confirmPassword: "a-strong-new-password" })
    expect(res.status).toBe(400)
  })

  it("rejects a token whose forced-reset flag has already been cleared (single-use)", async () => {
    testDb.prepare("UPDATE accounts SET must_reset_password = 0 WHERE id = 123").run()
    const token = mintTestToken("123", FUTURE_EXP, SECRET)
    const res = await postReset({ token, password: "a-strong-new-password", confirmPassword: "a-strong-new-password" })
    expect(res.status).toBe(400)
  })

  it("rejects a valid token used a second time after the first reset succeeds", async () => {
    const token = mintTestToken("123", FUTURE_EXP, SECRET)
    const first = await postReset({ token, password: "first-new-password", confirmPassword: "first-new-password" })
    expect(first.status).toBe(200)
    const second = await postReset({ token, password: "second-new-password", confirmPassword: "second-new-password" })
    expect(second.status).toBe(400)
  })

  it("rejects mismatched passwords", async () => {
    const token = mintTestToken("123", FUTURE_EXP, SECRET)
    const res = await postReset({ token, password: "a-strong-new-password", confirmPassword: "different" })
    expect(res.status).toBe(400)
  })

  it("rejects a password shorter than the configured minimum", async () => {
    const token = mintTestToken("123", FUTURE_EXP, SECRET)
    const res = await postReset({ token, password: "short", confirmPassword: "short" })
    expect(res.status).toBe(400)
  })

  it("rejects a missing token", async () => {
    const res = await postReset({ password: "a-strong-new-password", confirmPassword: "a-strong-new-password" })
    expect(res.status).toBe(400)
  })
})
