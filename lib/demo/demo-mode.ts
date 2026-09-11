// SPDX-License-Identifier: AGPL-3.0-only

/** Platform profile value that arms demo behaviour together with DEMO_MODE. */
export const DEMO_PLATFORM_PROFILE = "demo"

/**
 * Demo mode is active only when both DEMO_MODE and the platform demo profile are set.
 * Self-hosted instances ignore DEMO_MODE when FC_PLATFORM_PROFILE is absent.
 */
export function isDemoModeActive(): boolean {
  return (
    process.env.DEMO_MODE === "true" &&
    process.env.FC_PLATFORM_PROFILE === DEMO_PLATFORM_PROFILE
  )
}

/**
 * Fail fast when DEMO_MODE is set in a platform context without the demo profile.
 * Self-host (no FC_PLATFORM_PROFILE) ignores DEMO_MODE silently.
 */
export function validateDemoModeAtBoot(): void {
  if (process.env.DEMO_MODE !== "true") return
  const profile = process.env.FC_PLATFORM_PROFILE
  if (profile === undefined) return
  if (profile === DEMO_PLATFORM_PROFILE) return
  throw new Error(
    `DEMO_MODE=true requires FC_PLATFORM_PROFILE=${DEMO_PLATFORM_PROFILE} (got ${profile})`,
  )
}
