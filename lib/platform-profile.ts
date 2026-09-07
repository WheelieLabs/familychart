// SPDX-License-Identifier: AGPL-3.0-only

/** Managed SaaS platform profile (ADR-0004). */
export const MANAGED_PLATFORM_PROFILE = "managed"

export function getPlatformProfile(): string | undefined {
  const raw = process.env.FC_PLATFORM_PROFILE?.trim()
  return raw === "" ? undefined : raw
}

export function isManagedPlatformProfile(): boolean {
  return getPlatformProfile() === MANAGED_PLATFORM_PROFILE
}
