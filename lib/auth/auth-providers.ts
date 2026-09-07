// SPDX-License-Identifier: AGPL-3.0-only

/** Parse `ENABLED_AUTH_PROVIDERS` (legacy boot-seed for auth.entra.enabled, now DB-backed). */
export function parseEnabledAuthProviders(): string[] {
  const raw = process.env.ENABLED_AUTH_PROVIDERS
  const source = raw == null || raw.trim() === "" ? "credentials" : raw
  const parsed = source
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
  return parsed.length > 0 ? parsed : ["credentials"]
}

/** Whether Microsoft Entra ID provider should register at boot (legacy env; now DB-seeded). */
export function isEntraProviderEnabledViaEnv(): boolean {
  return parseEnabledAuthProviders().includes("entra")
}

/** Local credentials provider is always registered — it cannot be disabled via env. */
export const CREDENTIALS_PROVIDER_ALWAYS_ON = true
