import crypto from "node:crypto"
import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  deriveResetTokenKey,
  isForcedResetActive,
  redeemResetToken,
  verifyResetToken,
  verifyResetTokenSignature,
} from "@/lib/reset-token"

const SECRET = "test-nextauth-secret-fixed-vector-000000"

/** Mints a token via the same algorithm as familychart-admin's mint module, for DB-integration tests. */
function mintTestToken(userId: string, exp: number, secret: string): string {
  const payload = `${userId}.${exp}`
  const key = deriveResetTokenKey(secret)
  const signature = crypto.createHmac("sha256", key).update(`${payload}.password-reset`).digest()
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${Buffer.from(signature).toString("base64url")}`
}

// Known-answer test vector minted by familychart-admin's mint module
// (src/reset-token.js):
//   userId = "user-123"
//   exp    = 1735689600  (2025-01-01T00:00:00.000Z)
//   secret = "test-nextauth-secret-fixed-vector-000000"
const KNOWN_ANSWER_TOKEN = "dXNlci0xMjMuMTczNTY4OTYwMA.-Kuj0yg9mLji9N4758zm5S4vPNCs8C2SZiNkVBv1um8"
const KNOWN_ANSWER_USER_ID = "user-123"
const KNOWN_ANSWER_EXP = 1735689600

describe("verifyResetTokenSignature", () => {
  it("matches the cross-repo known-answer test vector from familychart-admin", () => {
    const result = verifyResetTokenSignature(KNOWN_ANSWER_TOKEN, SECRET, KNOWN_ANSWER_EXP - 1)
    expect(result).toEqual({ valid: true, userId: KNOWN_ANSWER_USER_ID })
  })

  it("rejects the known-answer token once its embedded expiry has passed", () => {
    const result = verifyResetTokenSignature(KNOWN_ANSWER_TOKEN, SECRET, KNOWN_ANSWER_EXP + 1)
    expect(result).toEqual({ valid: false })
  })

  it("rejects a tampered signature", () => {
    const [payload, sig] = KNOWN_ANSWER_TOKEN.split(".")
    const sigBytes = Buffer.from(sig!, "base64url")
    sigBytes[0] = sigBytes[0]! ^ 0xff
    const tampered = `${payload}.${sigBytes.toString("base64url")}`
    const result = verifyResetTokenSignature(tampered, SECRET, KNOWN_ANSWER_EXP - 1)
    expect(result).toEqual({ valid: false })
  })

  it("rejects a token signed with the wrong secret", () => {
    const result = verifyResetTokenSignature(KNOWN_ANSWER_TOKEN, "a-different-secret-entirely-000000", KNOWN_ANSWER_EXP - 1)
    expect(result).toEqual({ valid: false })
  })

  it("rejects malformed tokens", () => {
    expect(verifyResetTokenSignature("not-a-token", SECRET)).toEqual({ valid: false })
    expect(verifyResetTokenSignature("a.b.c", SECRET)).toEqual({ valid: false })
    expect(verifyResetTokenSignature("", SECRET)).toEqual({ valid: false })
    expect(verifyResetTokenSignature("!!!.!!!", SECRET)).toEqual({ valid: false })
  })

  it("rejects a payload with no embedded expiry", () => {
    const payloadB64 = Buffer.from("user-123", "utf8").toString("base64url")
    expect(verifyResetTokenSignature(`${payloadB64}.somesig`, SECRET)).toEqual({ valid: false })
  })
})

describe("deriveResetTokenKey", () => {
  it("derives a 32-byte key", () => {
    expect(deriveResetTokenKey(SECRET).length).toBe(32)
  })

  it("is deterministic for the same secret", () => {
    expect(deriveResetTokenKey(SECRET)).toEqual(deriveResetTokenKey(SECRET))
  })

  it("differs from the raw secret bytes", () => {
    const key = deriveResetTokenKey(SECRET)
    expect(key.toString("hex")).not.toBe(Buffer.from(SECRET, "utf8").toString("hex"))
  })

  it("requires a secret", () => {
    expect(() => deriveResetTokenKey("")).toThrow(/nextAuthSecret is required/)
  })
})

describe("isForcedResetActive / verifyResetToken", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
    db.exec(`
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
    `)
  })

  afterEach(() => {
    db.close()
  })

  it("isForcedResetActive is true while the flag is set", () => {
    db.prepare(
      "INSERT INTO accounts (id, email, password_hash, role, must_reset_password) VALUES (1, 'a@example.com', 'h', 'admin', 1)",
    ).run()
    expect(isForcedResetActive(db, "1")).toBe(true)
  })

  it("isForcedResetActive is false once the flag is cleared", () => {
    db.prepare(
      "INSERT INTO accounts (id, email, password_hash, role, must_reset_password) VALUES (1, 'a@example.com', 'h', 'admin', 0)",
    ).run()
    expect(isForcedResetActive(db, "1")).toBe(false)
  })

  it("isForcedResetActive is false for a nonexistent account", () => {
    expect(isForcedResetActive(db, "999")).toBe(false)
  })

  it("verifyResetToken accepts a valid token while forced-reset is active", () => {
    db.prepare(
      "INSERT INTO accounts (id, email, password_hash, role, must_reset_password) VALUES (123, 'a@example.com', 'h', 'admin', 1)",
    ).run()
    const token = mintTestToken("123", KNOWN_ANSWER_EXP, SECRET)
    const result = verifyResetToken(db, token, SECRET, KNOWN_ANSWER_EXP - 1)
    expect(result).toEqual({ valid: true, userId: "123" })
  })

  it("verifyResetToken rejects a valid token once forced-reset has been cleared (single-use)", () => {
    db.prepare(
      "INSERT INTO accounts (id, email, password_hash, role, must_reset_password) VALUES (123, 'a@example.com', 'h', 'admin', 0)",
    ).run()
    const token = mintTestToken("123", KNOWN_ANSWER_EXP, SECRET)
    const result = verifyResetToken(db, token, SECRET, KNOWN_ANSWER_EXP - 1)
    expect(result).toEqual({ valid: false })
  })

  it("verifyResetToken rejects a token for an account that no longer exists", () => {
    const token = mintTestToken("123", KNOWN_ANSWER_EXP, SECRET)
    const result = verifyResetToken(db, token, SECRET, KNOWN_ANSWER_EXP - 1)
    expect(result).toEqual({ valid: false })
  })

  it("verifyResetToken rejects an expired token even while forced-reset is active", () => {
    db.prepare(
      "INSERT INTO accounts (id, email, password_hash, role, must_reset_password) VALUES (123, 'a@example.com', 'h', 'admin', 1)",
    ).run()
    const token = mintTestToken("123", KNOWN_ANSWER_EXP, SECRET)
    const result = verifyResetToken(db, token, SECRET, KNOWN_ANSWER_EXP + 1)
    expect(result).toEqual({ valid: false })
  })
})

describe("redeemResetToken", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
    db.exec(`
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
    `)
    db.prepare(
      "INSERT INTO accounts (id, email, password_hash, role, must_reset_password) VALUES (123, 'a@example.com', 'old-hash', 'admin', 1)",
    ).run()
  })

  afterEach(() => {
    db.close()
  })

  it("sets the new password hash, clears the flag, and returns the account's email and id", () => {
    const token = mintTestToken("123", KNOWN_ANSWER_EXP, SECRET)
    const result = redeemResetToken(db, token, SECRET, "new-hash", KNOWN_ANSWER_EXP - 1)
    expect(result).toEqual({ ok: true, userId: "123", email: "a@example.com" })

    const row = db.prepare("SELECT password_hash, must_reset_password FROM accounts WHERE id = 123").get() as {
      password_hash: string
      must_reset_password: number
    }
    expect(row.password_hash).toBe("new-hash")
    expect(row.must_reset_password).toBe(0)
  })

  it("leaves the password unchanged when the token is invalid", () => {
    const token = mintTestToken("123", KNOWN_ANSWER_EXP, SECRET)
    const result = redeemResetToken(db, token, SECRET, "new-hash", KNOWN_ANSWER_EXP + 1)
    expect(result).toEqual({ ok: false })

    const row = db.prepare("SELECT password_hash FROM accounts WHERE id = 123").get() as { password_hash: string }
    expect(row.password_hash).toBe("old-hash")
  })

  it("rejects redeeming the same token a second time", () => {
    const token = mintTestToken("123", KNOWN_ANSWER_EXP, SECRET)
    const first = redeemResetToken(db, token, SECRET, "new-hash", KNOWN_ANSWER_EXP - 1)
    expect(first).toEqual({ ok: true, userId: "123", email: "a@example.com" })

    const second = redeemResetToken(db, token, SECRET, "another-hash", KNOWN_ANSWER_EXP - 1)
    expect(second).toEqual({ ok: false })

    const row = db.prepare("SELECT password_hash FROM accounts WHERE id = 123").get() as { password_hash: string }
    expect(row.password_hash).toBe("new-hash")
  })
})
