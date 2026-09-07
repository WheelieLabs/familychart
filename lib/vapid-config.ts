// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@/lib/logger"

import webpush from "web-push"
import type Database from "better-sqlite3-multiple-ciphers"
import { isManagedPlatformProfile } from "@/lib/platform-profile"
import { writeAppSettingValue } from "@/lib/settings/app-settings-store"
import {
  readRegistryEnvValue,
  SETTING_PUSH_VAPID_PRIVATE_KEY,
  SETTING_PUSH_VAPID_PUBLIC_KEY,
  SETTING_PUSH_VAPID_SUBJECT,
  getSettingDefinition,
} from "@/lib/settings/registry"
import { resolveSetting } from "@/lib/settings/resolver"

export interface VapidConfig {
  subject: string
  publicKey: string
  privateKey: string
}

function readDbValue(db: Database.Database, key: string): string | undefined {
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(key) as { value: string } | undefined
  return row?.value
}

/** Self-host: generate VAPID keypair once when env and DB are both absent. */
export function ensureVapidKeysGenerated(db: Database.Database): void {
  if (isManagedPlatformProfile()) return

  const pubEntry = getSettingDefinition(SETTING_PUSH_VAPID_PUBLIC_KEY)!
  const privEntry = getSettingDefinition(SETTING_PUSH_VAPID_PRIVATE_KEY)!

  if (readRegistryEnvValue(pubEntry) || readRegistryEnvValue(privEntry)) return
  if (readDbValue(db, SETTING_PUSH_VAPID_PUBLIC_KEY) || readDbValue(db, SETTING_PUSH_VAPID_PRIVATE_KEY)) {
    return
  }

  const keys = webpush.generateVAPIDKeys()
  const pub = writeAppSettingValue(db, SETTING_PUSH_VAPID_PUBLIC_KEY, keys.publicKey)
  const priv = writeAppSettingValue(db, SETTING_PUSH_VAPID_PRIVATE_KEY, keys.privateKey)
  if (!pub.ok || !priv.ok) {
    logger.error("[vapid] failed to persist generated keys", { pub, priv })
  } else {
    logger.info("vapid_keys_generated")
  }
}

/** Seed VAPID subject from admin email when unset (self-host first-run). */
export function seedVapidSubjectFromEmail(db: Database.Database, email: string | null | undefined): void {
  if (isManagedPlatformProfile()) return
  const entry = getSettingDefinition(SETTING_PUSH_VAPID_SUBJECT)!
  if (readRegistryEnvValue(entry)) return
  if (readDbValue(db, SETTING_PUSH_VAPID_SUBJECT)) return
  const trimmed = email?.trim()
  if (!trimmed) return
  const written = writeAppSettingValue(db, SETTING_PUSH_VAPID_SUBJECT, `mailto:${trimmed}`)
  if (!written.ok) {
    logger.error("[vapid] failed to seed subject", written)
  }
}

export function getVapidConfig(db: Database.Database): VapidConfig | null {
  ensureVapidKeysGenerated(db)

  const subject = resolveSetting(db, SETTING_PUSH_VAPID_SUBJECT).value.trim()
  const publicKey = resolveSetting(db, SETTING_PUSH_VAPID_PUBLIC_KEY).value.trim()
  const privateKey = resolveSetting(db, SETTING_PUSH_VAPID_PRIVATE_KEY).value.trim()

  if (!subject || !publicKey || !privateKey) return null
  return { subject, publicKey, privateKey }
}

export function isVapidConfigured(db: Database.Database): boolean {
  return getVapidConfig(db) != null
}
