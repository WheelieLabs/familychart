// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { formatHHMM, parseHHMM } from "@/lib/datetime"
import {
  HYDRATION_KEY_ACTIVE_END,
  HYDRATION_KEY_ACTIVE_START,
  HYDRATION_KEY_GLASS_SIZE,
  HYDRATION_KEY_LAST_NUDGE_AT,
  HYDRATION_KEY_LAST_RECORD_AT,
  HYDRATION_KEY_MUTED_UNTIL,
  validateHydrationConfigPartial,
  type HydrationPacingConfigPartial,
} from "@/lib/hydration/hydration-config"
import { USER_TIMEZONE_KEY } from "@/lib/hydration/hydration-timezone"
import { isValidIanaTz } from "@/lib/settings/registry"
import { writeUserSetting } from "@/lib/settings/user-settings-store"

/**
 * Format version that first carries durable per-user preferences. An older file has no such
 * section; a newer importer leaves those preferences untouched.
 */
export const USER_SETTINGS_FORMAT_VERSION = 2

export const NOTIFICATION_FIELDS = [
  "notify_prn",
  "notify_prescribed",
  "notify_overdue",
  "notify_observations",
  "notify_hydration",
] as const

export type NotificationField = (typeof NOTIFICATION_FIELDS)[number]

/** Hydration bookkeeping. Present on the Account, never written into an export. */
export const TRANSIENT_HYDRATION_KEYS = [
  HYDRATION_KEY_MUTED_UNTIL,
  HYDRATION_KEY_LAST_NUDGE_AT,
  HYDRATION_KEY_LAST_RECORD_AT,
] as const

const DURABLE_HYDRATION_KEYS = [
  HYDRATION_KEY_ACTIVE_START,
  HYDRATION_KEY_ACTIVE_END,
  HYDRATION_KEY_GLASS_SIZE,
] as const

export interface PortableNotifications {
  person_id: number
  notify_prn: boolean
  notify_prescribed: boolean
  notify_overdue: boolean
  notify_observations: boolean
  notify_hydration: boolean
}

export interface PortableHydration {
  person_id: number
  active_start?: string
  active_end?: string
  glass_size?: string
}

/** Household section row. Bundle-local ids only: no email and no Account uid. */
export interface PortableAccountSettings {
  account_id: number
  timezone?: string
  hydration?: PortableHydration
  notifications: PortableNotifications[]
}

/** Person-export section. The Personal-link Account's own settings for this Person. */
export interface PortablePersonSettings {
  person_id: number
  timezone?: string
  hydration?: Omit<PortableHydration, "person_id">
  notifications?: Omit<PortableNotifications, "person_id">
}

interface StoredSetting {
  key: string
  value: string
}

interface StoredNotification {
  person_id: number
  notify_prn: number
  notify_prescribed: number
  notify_overdue: number
  notify_observations: number
  notify_hydration: number
}

function bool(value: number): boolean {
  return value !== 0
}

function notificationsFromRow(
  row: StoredNotification,
  personId: number,
): PortableNotifications {
  return {
    person_id: personId,
    notify_prn: bool(row.notify_prn),
    notify_prescribed: bool(row.notify_prescribed),
    notify_overdue: bool(row.notify_overdue),
    notify_observations: bool(row.notify_observations),
    notify_hydration: bool(row.notify_hydration),
  }
}

function loadStoredSettings(db: Database.Database, userUid: string): StoredSetting[] {
  return db.prepare(
    "SELECT key, value FROM user_settings WHERE user_uid = ? ORDER BY key ASC",
  ).all(userUid) as StoredSetting[]
}

function loadStoredNotifications(db: Database.Database, userUid: string): StoredNotification[] {
  return db.prepare(
    `SELECT person_id, notify_prn, notify_prescribed, notify_overdue, notify_observations, notify_hydration
     FROM person_notification_prefs WHERE user_uid = ? ORDER BY person_id ASC`,
  ).all(userUid) as StoredNotification[]
}

function timezoneFrom(settings: StoredSetting[]): string | undefined {
  const row = settings.find(setting => setting.key === USER_TIMEZONE_KEY)
  const value = row?.value.trim()
  return value ? value : undefined
}

function hydrationFrom(settings: StoredSetting[], personId: number): PortableHydration | undefined {
  const hydration: PortableHydration = { person_id: personId }
  let any = false
  for (const key of DURABLE_HYDRATION_KEYS) {
    const row = settings.find(setting => setting.key === key)
    const value = row?.value.trim()
    if (!value) continue
    any = true
    if (key === HYDRATION_KEY_ACTIVE_START) hydration.active_start = value
    else if (key === HYDRATION_KEY_ACTIVE_END) hydration.active_end = value
    else hydration.glass_size = value
  }
  return any ? hydration : undefined
}

/**
 * Durable preferences for every Account in the household, keyed by the bundle-local Account id
 * and Person id. Transient hydration keys, push subscriptions, emails and Account uids are omitted.
 */
export function loadPortableHouseholdSettings(
  db: Database.Database,
  accountIdByUid: Map<string, number>,
  personBundleByDbId: Map<number, number>,
): PortableAccountSettings[] {
  const rows: PortableAccountSettings[] = []
  const uids = [...accountIdByUid.entries()].sort((a, b) => a[1] - b[1])
  for (const [uid, accountId] of uids) {
    const settings = loadStoredSettings(db, uid)
    const personLink = db.prepare(
      "SELECT id FROM people WHERE account_uid = ?",
    ).get(uid) as { id: number } | undefined
    const linkBundle = personLink ? personBundleByDbId.get(personLink.id) : undefined
    const timezone = timezoneFrom(settings)
    const hydration = linkBundle === undefined ? undefined : hydrationFrom(settings, linkBundle)
    const notifications = loadStoredNotifications(db, uid).flatMap(row => {
      const personId = personBundleByDbId.get(row.person_id)
      if (personId === undefined) return []
      return [notificationsFromRow(row, personId)]
    })
    if (!timezone && !hydration && notifications.length === 0) continue
    rows.push({
      account_id: accountId,
      ...(timezone ? { timezone } : {}),
      ...(hydration ? { hydration } : {}),
      notifications,
    })
  }
  return rows
}

/**
 * Settings held by this Person's Personal-link Account for the Person themself.
 * Another Account's preferences, and this Account's preferences about anyone else, are left out.
 */
export function loadPortablePersonSettings(
  db: Database.Database,
  personDbId: number,
  personBundleId: number,
): PortablePersonSettings {
  const link = db.prepare(
    "SELECT account_uid FROM people WHERE id = ?",
  ).get(personDbId) as { account_uid: string | null } | undefined
  const uid = link?.account_uid?.trim()
  const section: PortablePersonSettings = { person_id: personBundleId }
  if (!uid) return section

  const settings = loadStoredSettings(db, uid)
  const timezone = timezoneFrom(settings)
  if (timezone) section.timezone = timezone
  const hydration = hydrationFrom(settings, personBundleId)
  if (hydration) {
    const { person_id: _personId, ...rest } = hydration
    if (Object.keys(rest).length > 0) section.hydration = rest
  }
  const own = loadStoredNotifications(db, uid).find(row => row.person_id === personDbId)
  if (own) {
    const { person_id: _personId, ...rest } = notificationsFromRow(own, personBundleId)
    section.notifications = rest
  }
  return section
}

export interface DurableSettingsInput {
  timezone?: string
  hydration?: { active_start?: string; active_end?: string; glass_size?: string }
  notifications?: Array<{ person_db_id: number } & Omit<PortableNotifications, "person_id">>
}

export interface DurableSettingsCounts {
  applied: { timezone: number; hydration: number; notifications: number }
  kept: number
  dropped_invalid: number
}

export function emptyDurableCounts(): DurableSettingsCounts {
  return {
    applied: { timezone: 0, hydration: 0, notifications: 0 },
    kept: 0,
    dropped_invalid: 0,
  }
}

function addCounts(into: DurableSettingsCounts, extra: DurableSettingsCounts): void {
  into.applied.timezone += extra.applied.timezone
  into.applied.hydration += extra.applied.hydration
  into.applied.notifications += extra.applied.notifications
  into.kept += extra.kept
  into.dropped_invalid += extra.dropped_invalid
}

function hasKey(db: Database.Database, userUid: string, key: string): boolean {
  const row = db.prepare(
    "SELECT 1 AS ok FROM user_settings WHERE user_uid = ? AND key = ? LIMIT 1",
  ).get(userUid, key) as { ok: number } | undefined
  return row != null
}

function storedValue(db: Database.Database, userUid: string, key: string): string | undefined {
  const row = db.prepare(
    "SELECT value FROM user_settings WHERE user_uid = ? AND key = ?",
  ).get(userUid, key) as { value: string } | undefined
  return row?.value
}

function normaliseTime(value: string): string | null {
  const parsed = parseHHMM(value)
  if (!parsed) return null
  return formatHHMM(parsed.h, parsed.m)
}

/**
 * Fills missing durable keys on one Account. A key the Account already has is kept.
 * A value that fails validation is dropped and counted, and is not written.
 * `writeUserSetting` is the only `user_settings` write, and it does not add its own audit row:
 * the restore summary is the audit entry for these writes.
 */
export function applyDurableUserSettings(
  db: Database.Database,
  userUid: string,
  input: DurableSettingsInput,
  writing: boolean,
  actorEmail: string | null,
): DurableSettingsCounts {
  const counts = emptyDurableCounts()
  const uid = userUid.trim()
  if (uid === "") return counts

  if (input.timezone !== undefined) {
    const timezone = input.timezone.trim()
    if (timezone === "" || !isValidIanaTz(timezone)) {
      counts.dropped_invalid += 1
    } else if (hasKey(db, uid, USER_TIMEZONE_KEY)) {
      counts.kept += 1
    } else {
      if (writing) {
        writeUserSetting(db, { userUid: uid, key: USER_TIMEZONE_KEY, value: timezone, actorEmail, audit: false })
      }
      counts.applied.timezone += 1
    }
  }

  if (input.hydration) {
    const partial: HydrationPacingConfigPartial = {}
    const candidates: { key: string; value: string }[] = []
    if (input.hydration.active_start !== undefined) {
      const time = normaliseTime(input.hydration.active_start)
      if (!time) counts.dropped_invalid += 1
      else {
        partial.activeStart = time
        candidates.push({ key: HYDRATION_KEY_ACTIVE_START, value: time })
      }
    }
    if (input.hydration.active_end !== undefined) {
      const time = normaliseTime(input.hydration.active_end)
      if (!time) counts.dropped_invalid += 1
      else {
        partial.activeEnd = time
        candidates.push({ key: HYDRATION_KEY_ACTIVE_END, value: time })
      }
    }
    if (input.hydration.glass_size !== undefined) {
      if (!/^[1-9]\d*$/.test(input.hydration.glass_size.trim())) counts.dropped_invalid += 1
      else {
        partial.glassSize = Number.parseInt(input.hydration.glass_size.trim(), 10)
        candidates.push({ key: HYDRATION_KEY_GLASS_SIZE, value: String(partial.glassSize) })
      }
    }
    const existing: HydrationPacingConfigPartial = {}
    const start = storedValue(db, uid, HYDRATION_KEY_ACTIVE_START)
    const end = storedValue(db, uid, HYDRATION_KEY_ACTIVE_END)
    if (start) existing.activeStart = start
    if (end) existing.activeEnd = end
    const validated = Object.keys(partial).length === 0
      ? null
      : validateHydrationConfigPartial(partial, {
        activeStart: existing.activeStart ?? partial.activeStart ?? "07:00",
        activeEnd: existing.activeEnd ?? partial.activeEnd ?? "21:00",
        glassSize: partial.glassSize ?? 250,
      })
    if (validated && !validated.ok) {
      counts.dropped_invalid += candidates.length
    } else if (validated?.ok) {
      let wroteHydration = false
      for (const candidate of candidates) {
        if (hasKey(db, uid, candidate.key)) {
          counts.kept += 1
          continue
        }
        if (writing) {
          writeUserSetting(db, {
            userUid: uid, key: candidate.key, value: candidate.value, actorEmail, audit: false,
          })
        }
        wroteHydration = true
      }
      if (wroteHydration) counts.applied.hydration += 1
    }
  }

  for (const pref of input.notifications ?? []) {
    const fields = NOTIFICATION_FIELDS.map(field => pref[field])
    if (fields.some(value => typeof value !== "boolean")) {
      counts.dropped_invalid += fields.filter(value => typeof value !== "boolean").length
      continue
    }
    const existing = db.prepare(
      "SELECT 1 AS ok FROM person_notification_prefs WHERE person_id = ? AND user_uid = ? LIMIT 1",
    ).get(pref.person_db_id, uid) as { ok: number } | undefined
    if (existing) {
      counts.kept += 1
      continue
    }
    if (writing) {
      db.prepare(
        `INSERT INTO person_notification_prefs
          (person_id, user_uid, notify_prn, notify_prescribed, notify_overdue, notify_observations, notify_hydration)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        pref.person_db_id,
        uid,
        pref.notify_prn ? 1 : 0,
        pref.notify_prescribed ? 1 : 0,
        pref.notify_overdue ? 1 : 0,
        pref.notify_observations ? 1 : 0,
        pref.notify_hydration ? 1 : 0,
      )
    }
    counts.applied.notifications += 1
  }

  return counts
}

export function mergeDurableCounts(into: DurableSettingsCounts, extra: DurableSettingsCounts): void {
  addCounts(into, extra)
}
