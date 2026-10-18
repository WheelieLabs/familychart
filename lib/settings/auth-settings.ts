// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import {
  SETTING_AUTH_ENTRA_ENABLED,
  SETTING_AUTH_ENTRA_CLIENT_ID,
  SETTING_AUTH_ENTRA_TENANT_ID,
  SETTING_AUTH_ENTRA_CLIENT_SECRET,
} from "@/lib/settings/registry"
import { resolveSetting } from "@/lib/settings/resolver"

export interface EntraCredentials {
  clientId: string
  clientSecret: string
  tenantId: string
}

export function isEntraAuthEnabled(db: Database.Database): boolean {
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
