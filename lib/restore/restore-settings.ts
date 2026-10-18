// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import type { HouseholdExportPayload } from "@/lib/export/household-export"
import { HOUSEHOLD_PAYLOAD_ENTRY } from "@/lib/export/household-export"
import { upsertAppSetting } from "@/lib/settings/app-settings-store"
import { getSettingDefinition, validateSettingValue } from "@/lib/settings/registry"
import { resolveSetting } from "@/lib/settings/resolver"
import { getSettingUiMeta } from "@/lib/settings/ui-metadata"
import { ZipFile, HOUSEHOLD_MAX_BYTES } from "./zip-file"

export interface SettingsDifference {
  key: string
  label: string
  existing: string
  export: string
  reason: "kept" | "locked"
}

export interface SettingsSkip {
  key: string
  reason: "secret" | "platform_locked" | "sign_in" | "invalid" | "unknown"
}

export interface RestoreSettingsReport {
  applied: { key: string; value: string }[]
  differences: SettingsDifference[]
  skipped: SettingsSkip[]
  /** Durable per-user preferences are a separate restore step and are not written here. */
  per_user: "not restored"
}

function readHouseholdPayload(zipPath: string): HouseholdExportPayload | null {
  const zip = ZipFile.open(zipPath)
  try {
    const raw = zip.read(HOUSEHOLD_PAYLOAD_ENTRY, { maxBytes: HOUSEHOLD_MAX_BYTES })
    if (!raw) return null
    return JSON.parse(raw.toString("utf8")) as HouseholdExportPayload
  } finally {
    zip.close()
  }
}

/**
 * Non-secret, non-platform-locked instance settings. The target wins when it already
 * has a value or the setting is locked. Secrets and locked settings are never written.
 */
export function restoreSettings(
  db: Database.Database,
  zipPath: string,
  writing: boolean,
  actorEmail: string | null,
): RestoreSettingsReport | "not restored" {
  const payload = readHouseholdPayload(zipPath)
  if (!payload) return "not restored"

  const applied: { key: string; value: string }[] = []
  const differences: SettingsDifference[] = []
  const skipped: SettingsSkip[] = []

  for (const setting of payload.settings ?? []) {
    const key = setting.key
    const exported = typeof setting.value === "string" ? setting.value : ""
    const entry = getSettingDefinition(key)
    if (!entry) {
      skipped.push({ key, reason: "unknown" })
      continue
    }
    if (entry.secret) {
      skipped.push({ key, reason: "secret" })
      continue
    }
    // A restore must not point an instance at an identity provider; sign-in is set up on the instance.
    if (key.startsWith("auth.")) {
      skipped.push({ key, reason: "sign_in" })
      continue
    }
    if (entry.platformLocked) {
      skipped.push({ key, reason: "platform_locked" })
      continue
    }
    if (!validateSettingValue(key, exported).ok) {
      skipped.push({ key, reason: "invalid" })
      continue
    }

    const current = resolveSetting(db, key)
    if (current.locked) {
      if (current.value !== exported) {
        differences.push({
          key,
          label: getSettingUiMeta(key).label,
          existing: current.value,
          export: exported,
          reason: "locked",
        })
      }
      continue
    }
    if (current.source === "db") {
      if (current.value !== exported) {
        differences.push({
          key,
          label: getSettingUiMeta(key).label,
          existing: current.value,
          export: exported,
          reason: "kept",
        })
      }
      continue
    }
    if (current.value === exported) continue

    if (writing) {
      const written = upsertAppSetting(db, key, exported, actorEmail)
      if (!written.ok) {
        skipped.push({ key, reason: "invalid" })
        continue
      }
    }
    applied.push({ key, value: exported })
  }

  return { applied, differences, skipped, per_user: "not restored" }
}
