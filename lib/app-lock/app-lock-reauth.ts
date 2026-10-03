// SPDX-License-Identifier: AGPL-3.0-only

/**
 * How long a forced interactive Entra sign-in (prompt=login, max_age=0) counts as proof
 * of presence for the App lock opt-out/turn-off gate (ADR-0016). Generous
 * enough to cover the redirect round trip and the provider's own UI, tight enough that a
 * stale `entraAuthAt` from hours ago can't be replayed.
 */
export const ENTRA_APP_LOCK_REAUTH_MAX_AGE_MS = 5 * 60_000

/**
 * True when `entraAuthAt` (the session's last interactive-Entra-sign-in timestamp, see
 * lib/auth.ts) is recent enough to prove the account holder just completed a step-up
 * sign-in, rather than this being leftover from the original session login.
 */
export function isEntraAppLockReauthFresh(
  entraAuthAt: number | null | undefined,
  nowMs: number,
  maxAgeMs: number = ENTRA_APP_LOCK_REAUTH_MAX_AGE_MS,
): boolean {
  if (typeof entraAuthAt !== "number" || !Number.isFinite(entraAuthAt)) return false
  const age = nowMs - entraAuthAt
  return age >= 0 && age <= maxAgeMs
}
