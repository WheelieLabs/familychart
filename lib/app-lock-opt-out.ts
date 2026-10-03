// SPDX-License-Identifier: AGPL-3.0-only

/** Consecutive ceremony failures after which the lock screen offers the opt-out. */
export const APP_LOCK_OPT_OUT_FAILURE_THRESHOLD = 3

/**
 * The lock screen's "Turn off App lock on this device" only appears once the fix steps have
 * failed (ADR-0016): set-up-again failed after a reset, or three failures in a row.
 * A single frustrated error must never offer it.
 */
export function shouldOfferAppLockOptOut(input: {
  consecutiveFailures: number
  setupAfterResetFailed: boolean
}): boolean {
  return (
    input.setupAfterResetFailed
    || input.consecutiveFailures >= APP_LOCK_OPT_OUT_FAILURE_THRESHOLD
  )
}
