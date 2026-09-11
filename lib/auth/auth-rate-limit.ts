// SPDX-License-Identifier: AGPL-3.0-only

/**
 * In-memory auth rate limiter for single-instance deployments.
 * Resets on process restart; sufficient for bcrypt DoS and brute-force throttling.
 */

import { logger } from "@/lib/logger"
import { formatLocalAccountUid } from "@/lib/account/account-uid"

interface Bucket {
  failures: number
  windowStartMs: number
  lockedUntilMs: number
}

const buckets = new Map<string, Bucket>()

const WINDOW_MS = 15 * 60_000
/** Per-(ip,email) lockout threshold. */
const MAX_FAILURES = 10
/**
 * Per-email lockout threshold across all IPs. Higher than the per-IP cap so a
 * distributed IP pool cannot keep guessing one account indefinitely, while
 * keeping deliberate victim lockout costly. Independent of the client IP.
 */
const EMAIL_MAX_FAILURES = 50
const LOCKOUT_MS = 15 * 60_000

function pruneBucket(bucket: Bucket, now: number): void {
  if (now - bucket.windowStartMs > WINDOW_MS) {
    bucket.failures = 0
    bucket.windowStartMs = now
  }
}

export function authRateLimitKey(ip: string, email: string): string {
  return `${ip.trim().toLowerCase()}|${email.trim().toLowerCase()}`
}

/** IP-independent bucket key, so XFF rotation cannot escape the per-account cap. */
export function authRateLimitEmailKey(email: string): string {
  return `email:${email.trim().toLowerCase()}`
}

export function isAuthRateLimited(key: string, now = Date.now()): boolean {
  const bucket = buckets.get(key)
  if (!bucket) return false
  pruneBucket(bucket, now)
  return bucket.lockedUntilMs > now
}

export function recordAuthFailure(
  key: string,
  now = Date.now(),
  maxFailures = MAX_FAILURES,
): void {
  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = { failures: 0, windowStartMs: now, lockedUntilMs: 0 }
    buckets.set(key, bucket)
  }
  pruneBucket(bucket, now)
  bucket.failures++
  if (bucket.failures >= maxFailures) {
    bucket.lockedUntilMs = now + LOCKOUT_MS
    logger.warn("auth_lockout", { key, failures: bucket.failures, maxFailures })
  }
}

export function clearAuthFailures(key: string): void {
  buckets.delete(key)
}

/** Rate-limited if either the per-(ip,email) or the IP-independent per-email bucket is locked. */
export function isAuthRateLimitedFor(ip: string, email: string, now = Date.now()): boolean {
  return (
    isAuthRateLimited(authRateLimitKey(ip, email), now) ||
    isAuthRateLimited(authRateLimitEmailKey(email), now)
  )
}

/** Records a failure against both the per-(ip,email) and the IP-independent per-email bucket. */
export function recordAuthFailureFor(ip: string, email: string, now = Date.now()): void {
  recordAuthFailure(authRateLimitKey(ip, email), now, MAX_FAILURES)
  recordAuthFailure(authRateLimitEmailKey(email), now, EMAIL_MAX_FAILURES)
}

/** Clears both buckets on a successful authentication. */
export function clearAuthFailuresFor(ip: string, email: string): void {
  clearAuthFailures(authRateLimitKey(ip, email))
  clearAuthFailures(authRateLimitEmailKey(email))
}

/** Re-auth routes key by local user id so a stolen session cannot grind forever. */
export function authRateLimitLocalUserKey(localUserId: number): string {
  return formatLocalAccountUid(localUserId)
}

export function isAuthRateLimitedForLocalUser(
  ip: string,
  localUserId: number,
  now = Date.now(),
): boolean {
  return isAuthRateLimitedFor(ip, authRateLimitLocalUserKey(localUserId), now)
}

export function recordAuthFailureForLocalUser(
  ip: string,
  localUserId: number,
  now = Date.now(),
): void {
  recordAuthFailureFor(ip, authRateLimitLocalUserKey(localUserId), now)
}

export function clearAuthFailuresForLocalUser(ip: string, localUserId: number): void {
  clearAuthFailuresFor(ip, authRateLimitLocalUserKey(localUserId))
}

/** Precomputed bcrypt hash used to flatten timing for unknown emails. */
export const DUMMY_BCRYPT_HASH =
  "$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4J/HS.i8mG"

interface RequestBucket {
  count: number
  windowStartMs: number
}

const requestBuckets = new Map<string, RequestBucket>()

/** Test helper: wipe all in-memory buckets. */
export function resetAuthRateLimitForTests(): void {
  buckets.clear()
  requestBuckets.clear()
}

/** True when `key` has already used its request budget in the current window. */
function isRequestRateLimited(key: string, windowMs: number, maxRequests: number, now: number): boolean {
  const bucket = requestBuckets.get(key)
  if (!bucket) return false
  if (now - bucket.windowStartMs > windowMs) return false
  return bucket.count >= maxRequests
}

/** Record a request against `key`, about to run bcrypt, to rate-limit an unauthenticated endpoint. */
function recordRequestAttempt(key: string, windowMs: number, now: number): void {
  let bucket = requestBuckets.get(key)
  if (!bucket || now - bucket.windowStartMs > windowMs) {
    bucket = { count: 0, windowStartMs: now }
    requestBuckets.set(key, bucket)
  }
  bucket.count++
}

/**
 * Builds one IP-keyed, pre-bcrypt request limiter: a `keyFn`/`isRateLimited`/`recordAttempt`
 * triple sharing one window+budget. Every unauthenticated bcrypt-adjacent endpoint (bootstrap,
 * reset-password, invite-accept) needs exactly this shape — factored out so a future tuning
 * change to one can't silently drift from the others by editing only one copy.
 */
function createIpRequestLimiter(prefix: string, windowMs: number, maxRequests: number) {
  const keyFn = (ip: string): string => `${prefix}:${ip.trim().toLowerCase()}`
  return {
    rateLimitKey: keyFn,
    isRateLimited: (ip: string, now = Date.now()): boolean =>
      isRequestRateLimited(keyFn(ip), windowMs, maxRequests, now),
    recordAttempt: (ip: string, now = Date.now()): void => recordRequestAttempt(keyFn(ip), windowMs, now),
  }
}

const bootstrapLimiter = createIpRequestLimiter("bootstrap", 15 * 60_000, 5)
export const bootstrapRateLimitKey = bootstrapLimiter.rateLimitKey
/** True when this IP has already used its bootstrap attempt budget in the current window. */
export const isBootstrapRateLimited = bootstrapLimiter.isRateLimited
/** Record a bootstrap attempt that is about to run bcrypt, to rate-limit setup bootstrap. */
export const recordBootstrapAttempt = bootstrapLimiter.recordAttempt

const resetPasswordLimiter = createIpRequestLimiter("reset-password", 15 * 60_000, 10)
export const resetPasswordRateLimitKey = resetPasswordLimiter.rateLimitKey
/** True when this IP has already used its reset-password attempt budget in the current window. */
export const isResetPasswordRateLimited = resetPasswordLimiter.isRateLimited
/** Record a reset-password attempt that is about to run bcrypt, to rate-limit the reset-password route. */
export const recordResetPasswordAttempt = resetPasswordLimiter.recordAttempt

const inviteAcceptLimiter = createIpRequestLimiter("invite-accept", 15 * 60_000, 10)
export const inviteAcceptRateLimitKey = inviteAcceptLimiter.rateLimitKey
/** True when this IP has already used its invite-accept attempt budget in the current window. */
export const isInviteAcceptRateLimited = inviteAcceptLimiter.isRateLimited
/** Record an invite-accept attempt that is about to run bcrypt, to rate-limit the invite-accept route. */
export const recordInviteAcceptAttempt = inviteAcceptLimiter.recordAttempt
