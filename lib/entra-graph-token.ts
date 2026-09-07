// SPDX-License-Identifier: AGPL-3.0-only

/**
 * App-only Microsoft Graph client-credentials token for Entra sign-in app registration.
 * Shared by auth revalidation and access-control membership listing (ADR-0009).
 * Deliberately separate from `lib/graph-mail.ts` (managed mail uses different credentials).
 */

import {
  getSettingDefinition,
  readRegistryEnvValue,
  SETTING_AUTH_ENTRA_CLIENT_ID,
  SETTING_AUTH_ENTRA_CLIENT_SECRET,
  SETTING_AUTH_ENTRA_TENANT_ID,
} from "@/lib/settings/registry"

export interface EntraGraphConfig {
  tenantId: string
  clientId: string
  clientSecret: string
}

/** Injectable seam — live client-credentials fetch by default; tests supply a fake. */
export interface AppOnlyGraphTokenAdapter {
  getToken(cfg: EntraGraphConfig): Promise<string>
}

/**
 * Reads the *env-sourced* Entra sign-in app credentials only. Deliberately narrower
 * than the env-or-DB precedence used for the sign-in provider itself (`lib/auth.ts`,
 * `resolveEntraCredentials`) — enabling the hourly Graph revalidation poll requires an
 * additional app-only Graph permission grant on the same app registration, and env is
 * the simpler, explicit signal that an operator has actually done that (see ADR-0009).
 */
export function loadEntraGraphConfig(): EntraGraphConfig | null {
  const clientEntry = getSettingDefinition(SETTING_AUTH_ENTRA_CLIENT_ID)
  const tenantEntry = getSettingDefinition(SETTING_AUTH_ENTRA_TENANT_ID)
  const secretEntry = getSettingDefinition(SETTING_AUTH_ENTRA_CLIENT_SECRET)
  if (!clientEntry || !tenantEntry || !secretEntry) return null

  const clientId = readRegistryEnvValue(clientEntry)?.trim()
  const tenantId = readRegistryEnvValue(tenantEntry)?.trim()
  const clientSecret = readRegistryEnvValue(secretEntry)?.trim()
  if (!clientId || !tenantId || !clientSecret) return null

  return { tenantId, clientId, clientSecret }
}

let tokenCache: { token: string; expiresAt: number } | null = null

async function fetchLiveAppOnlyGraphToken(cfg: EntraGraphConfig): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token
  }
  const res = await fetch(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  })
  if (!res.ok) {
    throw new Error(`Graph token request failed (${res.status}): ${await res.text()}`)
  }
  const data = (await res.json()) as { access_token: string; expires_in: number }
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return tokenCache.token
}

const liveAdapter: AppOnlyGraphTokenAdapter = {
  getToken: fetchLiveAppOnlyGraphToken,
}

let adapter: AppOnlyGraphTokenAdapter = liveAdapter

export async function getAppOnlyGraphToken(cfg: EntraGraphConfig): Promise<string> {
  return adapter.getToken(cfg)
}

/** Test-only: replace the live token adapter (pass `null` to restore). */
export function __setAppOnlyGraphTokenAdapterForTests(
  next: AppOnlyGraphTokenAdapter | null,
): void {
  adapter = next ?? liveAdapter
}

/** Test-only: clears the module-level Graph token cache between test cases. */
export function __resetAppOnlyGraphTokenCacheForTests(): void {
  tokenCache = null
}
