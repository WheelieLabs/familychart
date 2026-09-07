// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { auditLog } from "@/lib/audit-log"
import { isManagedPlatformProfile } from "@/lib/platform-profile"
import { getSettingDefinition, validateSettingValue } from "@/lib/settings/registry"
import {
  resolveSetting,
  resolveSettingForAdmin,
  type AdminResolvedSetting,
} from "@/lib/settings/resolver"

export type UpsertAppSettingResult =
  | { ok: true; resolved: AdminResolvedSetting }
  | { ok: false; status: number; error: string }

export type WriteAppSettingValueResult =
  | { ok: true }
  | { ok: false; status: number; error: string }

/**
 * Shared settings write gate: registry membership, platformLocked (managed),
 * and env lock. Does not audit — callers that need an audit trail (admin API)
 * must log themselves.
 */
export function writeAppSettingValue(
  db: Database.Database,
  key: string,
  value: string,
): WriteAppSettingValueResult {
  const entry = getSettingDefinition(key)
  if (!entry) {
    return { ok: false, status: 400, error: "Unknown setting" }
  }

  if (entry.platformLocked && isManagedPlatformProfile()) {
    return { ok: false, status: 403, error: "Managed by platform" }
  }

  const current = resolveSetting(db, key)
  if (current.locked) {
    return { ok: false, status: 409, error: "Managed via environment" }
  }

  const trimmed = value.trim()

  if (entry.secret && trimmed === "") {
    db.prepare("DELETE FROM app_settings WHERE key = ?").run(key)
    return { ok: true }
  }

  const validated = validateSettingValue(key, trimmed)
  if (!validated.ok) {
    return { ok: false, status: 400, error: validated.error }
  }

  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
  ).run(key, trimmed, Date.now())

  return { ok: true }
}

export function upsertAppSetting(
  db: Database.Database,
  key: string,
  value: string,
  actorEmail: string | null | undefined,
): UpsertAppSettingResult {
  const entry = getSettingDefinition(key)
  if (!entry) {
    return { ok: false, status: 400, error: "Unknown setting" }
  }

  const trimmed = value.trim()
  const oldRow = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(key) as { value: string } | undefined
  const old_value = oldRow?.value ?? null

  const written = writeAppSettingValue(db, key, value)
  if (!written.ok) return written

  if (entry.secret && trimmed === "") {
    if (oldRow) {
      auditLog(db, actorEmail, "UPDATE", "app_settings", null, { key, changed: true, removed: true })
    }
  } else if (entry.secret) {
    auditLog(db, actorEmail, "UPDATE", "app_settings", null, { key, changed: true })
  } else {
    auditLog(db, actorEmail, "UPDATE", "app_settings", null, { key, old_value, new_value: trimmed })
  }

  const resolved = resolveSettingForAdmin(db, key)
  if (!resolved) return { ok: false, status: 400, error: "Unknown setting" }
  return { ok: true, resolved }
}
