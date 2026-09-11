// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { validateNextAuthSecretAtBoot } from "@/lib/auth/auth-secret"
import { isManagedPlatformProfile } from "@/lib/platform-profile"
import {
  APP_SETTINGS_REGISTRY,
  getSettingDefinition,
  readRegistryEnvValue,
  settingsInGroup,
  validateSettingValue,
  type SettingDefinition,
} from "@/lib/settings/registry"

export type SettingSource = "env" | "db" | "default"

/** Internal resolved value — includes secret plaintext. Never send to clients. */
export interface ResolvedSetting {
  key: string
  value: string
  source: SettingSource
  locked: boolean
}

/** Admin API / UI shape — secrets masked. */
export interface AdminResolvedSetting {
  key: string
  value: string
  source: SettingSource
  locked: boolean
  secret: boolean
  secretSet: boolean
}

function readDbValue(db: Database.Database, key: string): string | undefined {
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(key) as { value: string } | undefined
  return row?.value
}

function isGroupEnvLocked(entry: SettingDefinition): boolean {
  if (!entry.group) return false
  return settingsInGroup(entry.group).some(e => readRegistryEnvValue(e) !== undefined)
}

function isEntryVisibleToAdmin(entry: SettingDefinition): boolean {
  if (entry.platformLocked && isManagedPlatformProfile()) return false
  return true
}

function computeLocked(entry: SettingDefinition, source: SettingSource): boolean {
  if (source === "env") return true
  if (isGroupEnvLocked(entry)) return true
  return false
}

function resolveSettingInternal(db: Database.Database, key: string): ResolvedSetting {
  const entry = getSettingDefinition(key)
  if (!entry) throw new Error(`Unknown setting: ${key}`)

  const envValue = readRegistryEnvValue(entry)
  if (envValue !== undefined) {
    const validated = validateSettingValue(key, envValue)
    if (!validated.ok) {
      throw new Error(`Invalid ${entry.envVar} for ${key}: ${validated.error}`)
    }
    return { key, value: envValue, source: "env", locked: true }
  }

  const dbValue = readDbValue(db, key)
  if (dbValue !== undefined) {
    return { key, value: dbValue, source: "db", locked: computeLocked(entry, "db") }
  }

  return {
    key,
    value: entry.default,
    source: "default",
    locked: computeLocked(entry, "default"),
  }
}

/** Internal read path — full values including secrets. */
export function resolveSetting(db: Database.Database, key: string): ResolvedSetting {
  return resolveSettingInternal(db, key)
}

function secretIsSet(resolved: ResolvedSetting): boolean {
  if (resolved.value.trim() === "") return false
  return resolved.source === "env" || resolved.source === "db"
}

export function toAdminResolvedSetting(
  entry: SettingDefinition,
  resolved: ResolvedSetting,
): AdminResolvedSetting {
  const secret = entry.secret
  const secretSet = secret ? secretIsSet(resolved) : false
  return {
    key: resolved.key,
    value: secret ? "" : resolved.value,
    source: resolved.source,
    locked: resolved.locked,
    secret,
    secretSet,
  }
}

/** Admin API read path — masks secrets; omits platformLocked under managed. */
export function resolveSettingForAdmin(db: Database.Database, key: string): AdminResolvedSetting | null {
  const entry = getSettingDefinition(key)
  if (!entry || !isEntryVisibleToAdmin(entry)) return null
  return toAdminResolvedSetting(entry, resolveSettingInternal(db, key))
}

export function resolveAllAppSettingsForAdmin(db: Database.Database): AdminResolvedSetting[] {
  return Object.keys(APP_SETTINGS_REGISTRY)
    .map(key => resolveSettingForAdmin(db, key))
    .filter((row): row is AdminResolvedSetting => row != null)
}

/** @deprecated Use resolveAllAppSettingsForAdmin in admin routes. */
export function resolveAllAppSettings(db: Database.Database): ResolvedSetting[] {
  return Object.keys(APP_SETTINGS_REGISTRY).map(key => resolveSetting(db, key))
}

export function validateRegistryEnvAtBoot(): void {
  validateNextAuthSecretAtBoot()
  for (const entry of Object.values(APP_SETTINGS_REGISTRY)) {
    const envValue = readRegistryEnvValue(entry)
    if (envValue === undefined) continue
    const validated = validateSettingValue(entry.key, envValue)
    if (!validated.ok) {
      throw new Error(`Invalid ${entry.envVar} for ${entry.key}: ${validated.error}`)
    }
  }
}
