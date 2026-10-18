// SPDX-License-Identifier: AGPL-3.0-only

/**
 * How long a forced interactive Entra sign-in (prompt=login, max_age=0) counts as proof
 * of presence for the App lock opt-out/turn-off gate (ADR-0016). Generous
 * enough to cover the redirect round trip and the provider's own UI, tight enough that a
 * stale `auth_time` from hours ago can't be replayed.
 */
export const ENTRA_APP_LOCK_REAUTH_MAX_AGE_MS = 5 * 60_000

/**
 * How far in the future an id_token `auth_time` may be (provider/server clock skew) before
 * it is rejected outright. Anything within the allowance is clamped to "now".
 */
export const ENTRA_AUTH_TIME_CLOCK_SKEW_MS = 60_000

/**
 * Turns the Entra id_token `auth_time` claim (seconds since the epoch: when the user
 * last actually authenticated at the IdP) into ms for the session. Returns undefined when
 * the claim is missing, not a positive finite number, or dated beyond the clock-skew
 * allowance, so step-up fails closed. A silent SSO re-issue carries the original, old
 * `auth_time`, which is kept as-is so `isEntraAppLockReauthFresh` rejects it by age.
 */
export function resolveEntraAuthTimeMs(authTimeClaim: unknown, nowMs: number): number | undefined {
  if (typeof authTimeClaim !== "number" || !Number.isFinite(authTimeClaim) || authTimeClaim <= 0) {
    return undefined
  }
  const ms = authTimeClaim * 1000
  if (ms - nowMs > ENTRA_AUTH_TIME_CLOCK_SKEW_MS) return undefined
  return Math.min(ms, nowMs)
}

/**
 * Sets (or deletes) `entraAuthTime` on the JWT from the id_token profile's `auth_time` claim, so a
 * missing or invalid claim leaves it unset and step-up fails closed. Mutates and returns the token.
 */
export function applyEntraAuthTimeToToken<T extends object>(
  token: T,
  profile: { auth_time?: unknown },
  nowMs: number,
): T {
  const target = token as { entraAuthTime?: number }
  const authTime = resolveEntraAuthTimeMs(profile.auth_time, nowMs)
  if (authTime === undefined) delete target.entraAuthTime
  else target.entraAuthTime = authTime
  return token
}

/**
 * Records (or clears) `localAuthAt` on the JWT at sign-in time. Only the local password
 * sign-in (`credentials` provider) stamps it; any other provider clears it. Call it only when
 * the jwt callback has an `account` (an actual sign-in): session tokens are re-encoded on every
 * request, so `iat` is not the sign-in time and a bare refresh must leave the stamp untouched.
 * Mutates and returns the token.
 */
export function applyLocalAuthAtToToken<T extends object>(
  token: T,
  provider: string | undefined,
  nowMs: number,
): T {
  const target = token as { localAuthAt?: number }
  if (provider === "credentials") target.localAuthAt = nowMs
  else delete target.localAuthAt
  return token
}

/**
 * True when `entraAuthTime` (the session's id_token `auth_time` in ms, see
 * resolveEntraAuthTimeMs and lib/auth.ts) is recent enough to prove the account holder
 * just completed a forced interactive step-up sign-in. This is the IdP's own record of
 * when the user authenticated, not the time of the app sign-in, so a silent SSO re-issue
 * does not count.
 */
export function isEntraAppLockReauthFresh(
  entraAuthTime: number | null | undefined,
  nowMs: number,
  maxAgeMs: number = ENTRA_APP_LOCK_REAUTH_MAX_AGE_MS,
): boolean {
  if (typeof entraAuthTime !== "number" || !Number.isFinite(entraAuthTime)) return false
  const age = nowMs - entraAuthTime
  return age >= 0 && age <= maxAgeMs
}

/**
 * True when a local Account's password sign-in (`localAuthAt`, ms) is recent enough to count as
 * proof for first App lock set-up without asking for the password again (ADR-0016). Uses the same
 * window as the Entra step-up; missing, non-finite and future-dated values are refused.
 */
export function isLocalRecentSignInFresh(
  localAuthAt: number | null | undefined,
  nowMs: number,
  maxAgeMs: number = ENTRA_APP_LOCK_REAUTH_MAX_AGE_MS,
): boolean {
  return isEntraAppLockReauthFresh(localAuthAt, nowMs, maxAgeMs)
}
