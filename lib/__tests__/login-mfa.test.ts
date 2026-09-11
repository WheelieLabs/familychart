// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest"
import bcrypt from "bcryptjs"
import Database from "better-sqlite3-multiple-ciphers"
import { localAccountSignIn } from "@/lib/account/account-local-sign-in"
import { recordAuthFailureFor, resetAuthRateLimitForTests } from "@/lib/auth/auth-rate-limit"

/**
 * Exercises the Local Account sign-in check (lib/account-local-sign-in.ts) used by both
 * LoginForm (Option A — always-present OTP field) and NextAuth's Credentials `authorize`.
 */
function makeDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      totp_secret TEXT,
      role TEXT NOT NULL DEFAULT 'read',
      can_report INTEGER NOT NULL DEFAULT 0,
      session_version INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `)
  return db
}

describe("local Account sign-in", () => {
  beforeEach(() => {
    resetAuthRateLimitForTests()
  })

  it("rejects MFA user without OTP (setup wizard re-sign-in after enroll must send the code)", async () => {
    const db = makeDb()
    const hash = bcrypt.hashSync("secret", 4)
    db.prepare("INSERT INTO accounts (email, password_hash, totp_secret) VALUES (?, ?, ?)").run(
      "mfa@example.com",
      hash,
      "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
    )

    const result = await localAccountSignIn(db, {
      email: "mfa@example.com",
      password: "secret",
      ip: "1.2.3.4",
    })
    expect(result).toEqual({ ok: false, reason: "otp_missing" })
    db.close()
  })

  it("accepts non-MFA user without OTP", async () => {
    const db = makeDb()
    const hash = bcrypt.hashSync("secret", 4)
    db.prepare("INSERT INTO accounts (email, password_hash) VALUES (?, ?)").run(
      "plain@example.com",
      hash,
    )

    const result = await localAccountSignIn(db, {
      email: "plain@example.com",
      password: "secret",
      ip: "1.2.3.4",
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.session.email).toBe("plain@example.com")
      expect(result.session.id).toBe("local:1")
      expect(result.session.sessionVersion).toBe(0)
    }
    db.close()
  })

  it("accepts a login typed with different casing than the stored (lowercased-on-invite) email", async () => {
    // app/api/accounts/invites/route.ts always stores the email lowercased; an invitee
    // naturally types their own email with whatever casing they normally use.
    const db = makeDb()
    const hash = bcrypt.hashSync("secret", 4)
    db.prepare("INSERT INTO accounts (email, password_hash) VALUES (?, ?)").run(
      "john.doe@example.com",
      hash,
    )

    const result = await localAccountSignIn(db, {
      email: "John.Doe@Example.com",
      password: "secret",
      ip: "1.2.3.4",
    })
    expect(result.ok).toBe(true)
    db.close()
  })

  it("accepts demo OTP bypass when FC_PLATFORM_PROFILE=demo", async () => {
    const prev = process.env.FC_PLATFORM_PROFILE
    const prevDemo = process.env.DEMO_MODE
    process.env.FC_PLATFORM_PROFILE = "demo"
    process.env.DEMO_MODE = "true"
    try {
      const db = makeDb()
      const hash = bcrypt.hashSync("demoadmin", 4)
      db.prepare("INSERT INTO accounts (email, password_hash, totp_secret) VALUES (?, ?, ?)").run(
        "demoadmin@demo.local",
        hash,
        "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
      )

      const result = await localAccountSignIn(db, {
        email: "demoadmin@demo.local",
        password: "demoadmin",
        otp: "123456",
        ip: "1.2.3.4",
      })
      expect(result.ok).toBe(true)
      db.close()
    } finally {
      if (prev === undefined) delete process.env.FC_PLATFORM_PROFILE
      else process.env.FC_PLATFORM_PROFILE = prev
      if (prevDemo === undefined) delete process.env.DEMO_MODE
      else process.env.DEMO_MODE = prevDemo
    }
  })

  it("rejects a wrong OTP", async () => {
    const db = makeDb()
    const hash = bcrypt.hashSync("secret", 4)
    db.prepare("INSERT INTO accounts (email, password_hash, totp_secret) VALUES (?, ?, ?)").run(
      "mfa2@example.com",
      hash,
      "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
    )

    const result = await localAccountSignIn(db, {
      email: "mfa2@example.com",
      password: "secret",
      otp: "000000",
      ip: "1.2.3.4",
    })
    expect(result).toEqual({ ok: false, reason: "otp_invalid" })
    db.close()
  })

  it("denies a missing Account as credentials (dummy-hash path, no enumeration)", async () => {
    const db = makeDb()

    const result = await localAccountSignIn(db, {
      email: "nobody@example.com",
      password: "whatever",
      ip: "1.2.3.4",
    })
    expect(result).toEqual({ ok: false, reason: "credentials" })
    db.close()
  })

  it("denies before bcrypt once the real in-memory limiter is tripped", async () => {
    const db = makeDb()
    const hash = bcrypt.hashSync("secret", 4)
    db.prepare("INSERT INTO accounts (email, password_hash) VALUES (?, ?)").run(
      "limited@example.com",
      hash,
    )

    const ip = "9.9.9.9"
    for (let i = 0; i < 10; i++) recordAuthFailureFor(ip, "limited@example.com")

    const result = await localAccountSignIn(db, {
      email: "limited@example.com",
      password: "secret",
      ip,
    })
    expect(result).toEqual({ ok: false, reason: "rate_limited" })
    db.close()
  })

  it("denies an inactive Account as credentials (dummy-hash path, no enumeration)", async () => {
    const db = makeDb()
    const hash = bcrypt.hashSync("secret", 4)
    db.prepare(
      "INSERT INTO accounts (email, password_hash, is_active) VALUES (?, ?, 0)",
    ).run("inactive@example.com", hash)

    const result = await localAccountSignIn(db, {
      email: "inactive@example.com",
      password: "secret",
      ip: "1.2.3.4",
    })
    expect(result).toEqual({ ok: false, reason: "credentials" })
    db.close()
  })

  it("clears failure buckets for that IP and email on a successful sign-in", async () => {
    const db = makeDb()
    const hash = bcrypt.hashSync("secret", 4)
    db.prepare("INSERT INTO accounts (email, password_hash) VALUES (?, ?)").run(
      "clears@example.com",
      hash,
    )

    const ip = "5.5.5.5"
    for (let i = 0; i < 9; i++) recordAuthFailureFor(ip, "clears@example.com")

    const ok = await localAccountSignIn(db, { email: "clears@example.com", password: "secret", ip })
    expect(ok.ok).toBe(true)

    // The failure bucket was cleared, so a fresh run of failures is needed to lock out again —
    // 9 more (not just 1) should still leave the account unlocked.
    for (let i = 0; i < 9; i++) recordAuthFailureFor(ip, "clears@example.com")
    const stillOk = await localAccountSignIn(db, { email: "clears@example.com", password: "secret", ip })
    expect(stillOk.ok).toBe(true)
    db.close()
  })
})
