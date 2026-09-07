// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { logger } from "@/lib/logger"
import { isEntraProviderEnabledViaEnv } from "@/lib/auth/auth-providers"
import {
  readRegistryEnvValue,
  SETTING_AUTH_ENTRA_ENABLED,
  SETTING_AUTH_ENTRA_CLIENT_ID,
  SETTING_AUTH_ENTRA_TENANT_ID,
  SETTING_AUTH_ENTRA_CLIENT_SECRET,
  getSettingDefinition,
} from "@/lib/settings/registry"
import { resolveSetting } from "@/lib/settings/resolver"

export interface EntraCredentials {
  clientId: string
  clientSecret: string
  tenantId: string
}

/** One-time boot seed: legacy ENABLED_AUTH_PROVIDERS → auth.entra.enabled. */
export function seedAuthSettingsFromLegacyEnv(db: Database.Database): void {
  const entry = getSettingDefinition(SETTING_AUTH_ENTRA_ENABLED)
  if (!entry) return

  if (readRegistryEnvValue(entry) !== undefined) return

  const existing = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(SETTING_AUTH_ENTRA_ENABLED) as { value: string } | undefined
  if (existing) return

  if (!isEntraProviderEnabledViaEnv()) return

  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)`,
  ).run(SETTING_AUTH_ENTRA_ENABLED, "true", Date.now())
  logger.info("auth_settings_seeded_from_legacy_env", { key: SETTING_AUTH_ENTRA_ENABLED })
}

export function isEntraAuthEnabled(db: Database.Database): boolean {
  seedAuthSettingsFromLegacyEnv(db)
  return resolveSetting(db, SETTING_AUTH_ENTRA_ENABLED).value === "true"
}

export function entraCredentialsConfigured(db: Database.Database): boolean {
  return resolveEntraCredentials(db) !== null
}

/**
 * Resolves the Entra credentials NextAuth should actually use, env-first with DB
 * fallback — the same precedence as every other registry setting. `lib/auth.ts`
 * builds its `MicrosoftEntraID` provider from exactly this, request-time, instead of
 * `process.env` at module load, so a self-hoster who configures Entra purely through
 * System Settings (DB-only, no env vars) gets working sign-in, not just a correctly
 * hidden button.
 */
export function resolveEntraCredentials(db: Database.Database): EntraCredentials | null {
  const clientId = resolveSetting(db, SETTING_AUTH_ENTRA_CLIENT_ID).value.trim()
  const tenantId = resolveSetting(db, SETTING_AUTH_ENTRA_TENANT_ID).value.trim()
  const clientSecret = resolveSetting(db, SETTING_AUTH_ENTRA_CLIENT_SECRET).value.trim()
  if (clientId === "" || tenantId === "" || clientSecret === "") return null
  return { clientId, clientSecret, tenantId }
}

/**
 * True when Entra sign-in will actually work: `auth.entra.enabled` resolves true and
 * credentials resolve from either source. `lib/auth.ts` gates provider construction on
 * this exact same function, so the login button and the actual registration can never
 * disagree.
 */
export function isEntraProviderActive(db: Database.Database): boolean {
  return isEntraAuthEnabled(db) && entraCredentialsConfigured(db)
}
