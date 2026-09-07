// SPDX-License-Identifier: AGPL-3.0-only

import crypto from "node:crypto"
import type Database from "better-sqlite3-multiple-ciphers"

/**
 * Purpose-scoped HKDF info string, also appended to the HMAC message as a domain
 * separator — key separation from session-JWT signing. Must match familychart-admin's
 * mint-side implementation exactly (ADR-0014 / familychart-admin ADR-0001).
 */
const RESET_TOKEN_INFO = "password-reset"

/**
 * Derive the reset-token verification key from an instance's NextAuth secret via HKDF.
 * Never verify with the raw secret — this keeps reset-token handling isolated from
 * session-token signing, so a bug in one can't be leveraged against the other.
 */
export function deriveResetTokenKey(nextAuthSecret: string): Buffer {
  if (!nextAuthSecret) throw new Error("nextAuthSecret is required")
  return Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(nextAuthSecret, "utf8"), Buffer.alloc(0), RESET_TOKEN_INFO, 32),
  )
}

export type VerifyResetTokenResult =
  | { valid: true; userId: string }
  | { valid: false }

/**
 * Verify a reset token's signature and expiry only — no database access.
 *
 * Algorithm (must match familychart-admin's mint-side implementation exactly):
 *   key       = HKDF-SHA256(ikm: nextAuthSecret, salt: '', info: 'password-reset', length: 32)
 *   payload   = `${userId}.${exp}`
 *   signature = HMAC-SHA256(key, `${payload}.password-reset`)
 *   token     = base64url(payload) + '.' + base64url(signature)
 */
export function verifyResetTokenSignature(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): VerifyResetTokenResult {
  const parts = token.split(".")
  if (parts.length !== 2) return { valid: false }
  const [payloadB64, sigB64] = parts
  if (!payloadB64 || !sigB64) return { valid: false }

  let payload: string
  let providedSig: Buffer
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf8")
    providedSig = Buffer.from(sigB64, "base64url")
  } catch {
    return { valid: false }
  }

  // userId is joined into the payload with '.'; split on the *last* '.' since
  // userId itself never contains one (DB-generated ids only — mirrors the mint
  // side's assumption).
  const lastDot = payload.lastIndexOf(".")
  if (lastDot === -1) return { valid: false }
  const userId = payload.slice(0, lastDot)
  const expRaw = payload.slice(lastDot + 1)
  if (!userId || !/^\d+$/.test(expRaw)) return { valid: false }
  const exp = Number(expRaw)

  const key = deriveResetTokenKey(secret)
  const expectedSig = crypto.createHmac("sha256", key).update(`${payload}.${RESET_TOKEN_INFO}`).digest()

  if (providedSig.length !== expectedSig.length || !crypto.timingSafeEqual(providedSig, expectedSig)) {
    return { valid: false }
  }

  if (exp < nowSeconds) return { valid: false }

  return { valid: true, userId }
}

interface ForcedResetRow {
  must_reset_password: number
}

/** True while `userId`'s forced-reset flag is still set — false once cleared or the account is gone. */
export function isForcedResetActive(db: Database.Database, userId: string): boolean {
  // accounts.id is an integer primary key; the token payload carries it as a string, so
  // parse it explicitly rather than relying on SQLite's implicit TEXT/INTEGER affinity coercion.
  if (!/^\d+$/.test(userId)) return false
  const row = db
    .prepare("SELECT must_reset_password FROM accounts WHERE id = ?")
    .get(Number(userId)) as ForcedResetRow | undefined
  return row?.must_reset_password === 1
}

/**
 * Verify a reset token end to end: signature, expiry, and that the target account's
 * forced-reset flag is still set. This last check is what makes the token single-use in
 * practice — once a reset completes and the flag clears, any other copy of the same
 * token, even a previously-logged one, is permanently rejected.
 */
export function verifyResetToken(
  db: Database.Database,
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): VerifyResetTokenResult {
  const signatureResult = verifyResetTokenSignature(token, secret, nowSeconds)
  if (!signatureResult.valid) return signatureResult
  if (!isForcedResetActive(db, signatureResult.userId)) return { valid: false }
  return signatureResult
}

export type RedeemResetTokenResult =
  | { ok: true; userId: string; email: string }
  | { ok: false }

/**
 * Verify a reset token and, if valid, atomically set the new password hash and clear the
 * forced-reset flag in one `BEGIN IMMEDIATE` transaction — closing the race where two
 * concurrent requests both pass verification before either clears the flag, which would
 * otherwise let the same token be redeemed twice.
 */
export function redeemResetToken(
  db: Database.Database,
  token: string,
  secret: string,
  passwordHash: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): RedeemResetTokenResult {
  return db
    .transaction((): RedeemResetTokenResult => {
      const result = verifyResetToken(db, token, secret, nowSeconds)
      if (!result.valid) return { ok: false }

      const updated = db
        .prepare("UPDATE accounts SET password_hash = ?, must_reset_password = 0 WHERE id = ?")
        .run(passwordHash, Number(result.userId))
      if (updated.changes === 0) return { ok: false }

      const row = db.prepare("SELECT email FROM accounts WHERE id = ?").get(Number(result.userId)) as
        | { email: string }
        | undefined
      if (!row) return { ok: false }

      return { ok: true, userId: result.userId, email: row.email }
    })
    .immediate()
}
