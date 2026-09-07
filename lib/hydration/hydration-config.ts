// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { formatHHMM, parseHHMM } from "@/lib/datetime"
import { writeUserSetting, type UserSettingWriteOpts } from "@/lib/settings/user-settings-store"

export type HydrationUserSettingWriteOptions = UserSettingWriteOpts

export const HYDRATION_KEY_ACTIVE_START = "hydration.active_start"
export const HYDRATION_KEY_ACTIVE_END = "hydration.active_end"
export const HYDRATION_KEY_GLASS_SIZE = "hydration.glass_size"
export const HYDRATION_KEY_LAST_NUDGE_AT = "hydration.last_nudge_at"
export const HYDRATION_KEY_LAST_RECORD_AT = "hydration.last_record_at"
export const HYDRATION_KEY_MUTED_UNTIL = "hydration.muted_until"

const HYDRATION_KEYS = [
  HYDRATION_KEY_ACTIVE_START,
  HYDRATION_KEY_ACTIVE_END,
  HYDRATION_KEY_GLASS_SIZE,
  HYDRATION_KEY_LAST_NUDGE_AT,
  HYDRATION_KEY_LAST_RECORD_AT,
  HYDRATION_KEY_MUTED_UNTIL,
] as const

export const HYDRATION_PACING_KEYS = [
  HYDRATION_KEY_ACTIVE_START,
  HYDRATION_KEY_ACTIVE_END,
  HYDRATION_KEY_GLASS_SIZE,
] as const

export function isHydrationPacingKey(key: string): boolean {
  return (HYDRATION_PACING_KEYS as readonly string[]).includes(key)
}

export function isHydrationConfigDefaultValue(key: string, value: string): boolean {
  if (key === HYDRATION_KEY_ACTIVE_START) {
    return (normaliseTime(value) ?? DEFAULT_ACTIVE_START) === DEFAULT_ACTIVE_START
  }
  if (key === HYDRATION_KEY_ACTIVE_END) {
    return (normaliseTime(value) ?? DEFAULT_ACTIVE_END) === DEFAULT_ACTIVE_END
  }
  if (key === HYDRATION_KEY_GLASS_SIZE) {
    return value === String(DEFAULT_GLASS_SIZE)
  }
  return false
}

/** Prefer orphan/custom source over profile-seeded defaults already on the canonical uid. */
export function shouldPreferHydrationMergeSource(
  target: { value: string; updated_at: number },
  source: { value: string; updated_at: number },
  key: string,
): boolean {
  if (!isHydrationPacingKey(key)) return false
  const targetDefault = isHydrationConfigDefaultValue(key, target.value)
  const sourceDefault = isHydrationConfigDefaultValue(key, source.value)
  if (targetDefault && !sourceDefault) return true
  return false
}

export const DEFAULT_ACTIVE_START = "07:00"
export const DEFAULT_ACTIVE_END = "21:00"
export const DEFAULT_GLASS_SIZE = 250

/** Pacing fallback when a person has no configured active window (not valid as HH:MM strings). */
export const FLAT_ACTIVE_START_MIN = 0
export const FLAT_ACTIVE_END_MIN = 24 * 60

export interface HydrationPacingConfig {
  activeStart: string
  activeEnd: string
  glassSize: number
}

export interface HydrationPacingConfigPartial {
  activeStart?: string
  activeEnd?: string
  glassSize?: number
}

export interface HydrationPacingConfigPatch {
  active_start?: string
  active_end?: string
  glass_size?: number
}

export interface HydrationWindowMinutes {
  activeStartMin: number
  activeEndMin: number
  glassSize: number
}

type HydrationStored = Partial<Record<(typeof HYDRATION_KEYS)[number], string>>

function parseEpochMs(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function parseLastNudgeAt(value: string | undefined): number | null {
  return parseEpochMs(value)
}

function parseMutedUntilYmd(value: string | undefined): string | null {
  if (value == null || value.trim() === "") return null
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null
  return trimmed
}

function minutesSinceMidnight(hhmm: string): number {
  const hm = parseHHMM(hhmm)
  if (!hm) return NaN
  return hm.h * 60 + hm.m
}

function normaliseTime(value: string): string | null {
  const hm = parseHHMM(value)
  if (!hm) return null
  return formatHHMM(hm.h, hm.m)
}

function parseGlassSize(value: string): number | null {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

export function validateHydrationConfigPartial(
  partial: HydrationPacingConfigPartial,
  existing?: HydrationPacingConfig
): { ok: true; normalised: HydrationPacingConfigPartial } | { ok: false; error: string } {
  const normalised: HydrationPacingConfigPartial = {}

  if (partial.activeStart !== undefined) {
    const t = normaliseTime(partial.activeStart)
    if (!t) return { ok: false, error: "active_start must be a valid HH:MM time" }
    normalised.activeStart = t
  }
  if (partial.activeEnd !== undefined) {
    const t = normaliseTime(partial.activeEnd)
    if (!t) return { ok: false, error: "active_end must be a valid HH:MM time" }
    normalised.activeEnd = t
  }
  if (partial.glassSize !== undefined) {
    if (!Number.isInteger(partial.glassSize) || partial.glassSize <= 0) {
      return { ok: false, error: "glass_size must be a positive integer (mL)" }
    }
    normalised.glassSize = partial.glassSize
  }

  const start = normalised.activeStart ?? existing?.activeStart ?? DEFAULT_ACTIVE_START
  const end = normalised.activeEnd ?? existing?.activeEnd ?? DEFAULT_ACTIVE_END
  const startMin = minutesSinceMidnight(start)
  const endMin = minutesSinceMidnight(end)
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) {
    return { ok: false, error: "Invalid active window times" }
  }
  if (startMin >= endMin) {
    return { ok: false, error: "active_start must be before active_end (midnight-crossing is not supported)" }
  }

  return { ok: true, normalised }
}

export function patchBodyToPartial(body: HydrationPacingConfigPatch): HydrationPacingConfigPartial {
  const partial: HydrationPacingConfigPartial = {}
  if (body.active_start !== undefined) partial.activeStart = body.active_start
  if (body.active_end !== undefined) partial.activeEnd = body.active_end
  if (body.glass_size !== undefined) partial.glassSize = body.glass_size
  return partial
}

/** Pure resolver for stored KV strings — used by getHydrationConfig and unit tests (no SQLite). */
export function resolveHydrationConfigFromStored(
  stored: Partial<Record<(typeof HYDRATION_KEYS)[number], string>>
): HydrationPacingConfig {
  const activeStart =
    normaliseTime(stored[HYDRATION_KEY_ACTIVE_START] ?? DEFAULT_ACTIVE_START) ?? DEFAULT_ACTIVE_START
  const activeEnd =
    normaliseTime(stored[HYDRATION_KEY_ACTIVE_END] ?? DEFAULT_ACTIVE_END) ?? DEFAULT_ACTIVE_END
  const glassRaw = stored[HYDRATION_KEY_GLASS_SIZE]
  const glassSize = glassRaw != null ? (parseGlassSize(glassRaw) ?? DEFAULT_GLASS_SIZE) : DEFAULT_GLASS_SIZE
  return { activeStart, activeEnd, glassSize }
}

function glassSizeFromStored(stored: HydrationStored): number {
  const glassRaw = stored[HYDRATION_KEY_GLASS_SIZE]
  return glassRaw != null ? (parseGlassSize(glassRaw) ?? DEFAULT_GLASS_SIZE) : DEFAULT_GLASS_SIZE
}

function flatHydrationWindow(glassSize = DEFAULT_GLASS_SIZE): HydrationWindowMinutes {
  return {
    activeStartMin: FLAT_ACTIVE_START_MIN,
    activeEndMin: FLAT_ACTIVE_END_MIN,
    glassSize,
  }
}

/**
 * Pacing window for a person: flat calendar-day pacing unless both start and end are stored.
 * Form-seed defaults (07:00–21:00) are never applied here — those are for Profile display only.
 */
export function resolveHydrationWindowMinutesFromStored(
  personUserUid: string | null | undefined,
  stored: HydrationStored = {}
): HydrationWindowMinutes {
  if (personUserUid == null || personUserUid.trim() === "") {
    return flatHydrationWindow()
  }

  const startRaw = stored[HYDRATION_KEY_ACTIVE_START]
  const endRaw = stored[HYDRATION_KEY_ACTIVE_END]
  const glassSize = glassSizeFromStored(stored)

  if (startRaw == null || endRaw == null) {
    return flatHydrationWindow(glassSize)
  }

  const start = normaliseTime(startRaw)
  const end = normaliseTime(endRaw)
  if (!start || !end) {
    return flatHydrationWindow(glassSize)
  }

  const startMin = minutesSinceMidnight(start)
  const endMin = minutesSinceMidnight(end)
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || startMin >= endMin) {
    return flatHydrationWindow(glassSize)
  }

  return { activeStartMin: startMin, activeEndMin: endMin, glassSize }
}

export function loadHydrationSettingsForUserUids(
  db: Database.Database,
  userUids: string[]
): Map<string, HydrationStored> {
  const unique = [...new Set(userUids.filter(uid => uid.trim() !== ""))]
  const out = new Map<string, HydrationStored>()
  if (unique.length === 0) return out

  const rows = db
    .prepare(
      `SELECT user_uid, key, value FROM user_settings
       WHERE user_uid IN (${unique.map(() => "?").join(",")})
         AND key IN (?, ?, ?, ?, ?, ?)`
    )
    .all(
      ...unique,
      HYDRATION_KEY_ACTIVE_START,
      HYDRATION_KEY_ACTIVE_END,
      HYDRATION_KEY_GLASS_SIZE,
      HYDRATION_KEY_LAST_NUDGE_AT,
      HYDRATION_KEY_LAST_RECORD_AT,
      HYDRATION_KEY_MUTED_UNTIL,
    ) as { user_uid: string; key: string; value: string }[]

  for (const row of rows) {
    if (
      row.key !== HYDRATION_KEY_ACTIVE_START &&
      row.key !== HYDRATION_KEY_ACTIVE_END &&
      row.key !== HYDRATION_KEY_GLASS_SIZE &&
      row.key !== HYDRATION_KEY_LAST_NUDGE_AT &&
      row.key !== HYDRATION_KEY_LAST_RECORD_AT &&
      row.key !== HYDRATION_KEY_MUTED_UNTIL
    ) {
      continue
    }
    const bucket = out.get(row.user_uid) ?? {}
    bucket[row.key as (typeof HYDRATION_KEYS)[number]] = row.value
    out.set(row.user_uid, bucket)
  }
  return out
}

export interface HydrationSettingRow {
  user_uid: string
  key: string
  value: string
  updated_at: number
}

export function loadHydrationSettingRowsForUserUids(
  db: Database.Database,
  userUids: string[],
): HydrationSettingRow[] {
  const unique = [...new Set(userUids.map(uid => uid.trim()).filter(uid => uid !== ""))]
  if (unique.length === 0) return []

  return db
    .prepare(
      `SELECT user_uid, key, value, updated_at FROM user_settings
       WHERE user_uid IN (${unique.map(() => "?").join(",")})
         AND key IN (?, ?, ?, ?, ?, ?)`,
    )
    .all(
      ...unique,
      HYDRATION_KEY_ACTIVE_START,
      HYDRATION_KEY_ACTIVE_END,
      HYDRATION_KEY_GLASS_SIZE,
      HYDRATION_KEY_LAST_NUDGE_AT,
      HYDRATION_KEY_LAST_RECORD_AT,
      HYDRATION_KEY_MUTED_UNTIL,
    ) as HydrationSettingRow[]
}

function shouldPreferNonPacingHydrationStoredSource(
  key: string,
  target: { value: string; updated_at: number },
  source: { value: string; updated_at: number },
): boolean {
  if (key === HYDRATION_KEY_LAST_NUDGE_AT || key === HYDRATION_KEY_LAST_RECORD_AT) {
    const targetMs = parseEpochMs(target.value) ?? 0
    const sourceMs = parseEpochMs(source.value) ?? 0
    return sourceMs > targetMs
  }
  if (key === HYDRATION_KEY_MUTED_UNTIL) {
    return source.value > target.value
  }
  return false
}

/** Merge hydration rows across linked account uids (pacing, mute, nudge anchors). */
export function mergeHydrationStoredForCandidateUids(
  rows: HydrationSettingRow[],
  candidateUids: string[],
): HydrationStored {
  const uidSet = new Set(candidateUids.map(uid => uid.trim()).filter(uid => uid !== ""))
  const bestByKey = new Map<string, { value: string; updated_at: number }>()

  for (const row of rows) {
    if (!uidSet.has(row.user_uid)) continue
    if (!(HYDRATION_KEYS as readonly string[]).includes(row.key)) continue

    const candidate = { value: row.value, updated_at: row.updated_at }
    const current = bestByKey.get(row.key)
    if (!current) {
      bestByKey.set(row.key, candidate)
      continue
    }
    if (isHydrationPacingKey(row.key)) {
      if (shouldPreferHydrationMergeSource(current, candidate, row.key)) {
        bestByKey.set(row.key, candidate)
      }
      continue
    }
    if (shouldPreferNonPacingHydrationStoredSource(row.key, current, candidate)) {
      bestByKey.set(row.key, candidate)
    }
  }

  const stored: HydrationStored = {}
  for (const [key, { value }] of bestByKey) {
    stored[key as (typeof HYDRATION_KEYS)[number]] = value
  }
  return stored
}

export function loadMergedHydrationStoredForUserUids(
  db: Database.Database,
  userUids: string[],
): HydrationStored {
  return mergeHydrationStoredForCandidateUids(
    loadHydrationSettingRowsForUserUids(db, userUids),
    userUids,
  )
}

export function resolveHydrationWindowMinutes(
  db: Database.Database,
  personUserUid: string | null | undefined
): HydrationWindowMinutes {
  if (personUserUid == null || personUserUid.trim() === "") {
    return flatHydrationWindow()
  }
  const storedByUid = loadHydrationSettingsForUserUids(db, [personUserUid])
  return resolveHydrationWindowMinutesFromStored(
    personUserUid,
    storedByUid.get(personUserUid) ?? {}
  )
}

export function getHydrationConfig(db: Database.Database, userUid: string): HydrationPacingConfig {
  return getHydrationConfigForUserUids(db, [userUid])
}

/** Read pacing config across linked account uids (legacy link / push account split). */
export function getHydrationConfigForUserUids(
  db: Database.Database,
  userUids: string[],
): HydrationPacingConfig {
  return resolveHydrationConfigFromStored(loadMergedHydrationStoredForUserUids(db, userUids))
}

export function setHydrationConfig(
  db: Database.Database,
  userUid: string,
  partial: HydrationPacingConfigPartial,
  existingConfig?: HydrationPacingConfig,
  writeOpts?: HydrationUserSettingWriteOptions,
): HydrationPacingConfig {
  const existing = existingConfig ?? getHydrationConfig(db, userUid)
  const validated = validateHydrationConfigPartial(partial, existing)
  if (!validated.ok) throw new Error(validated.error)

  const activeStart = validated.normalised.activeStart ?? existing.activeStart
  const activeEnd = validated.normalised.activeEnd ?? existing.activeEnd
  const glassSize = validated.normalised.glassSize ?? existing.glassSize
  const opts = {
    actorEmail: writeOpts?.actorEmail,
    audit: writeOpts?.audit,
  }

  writeUserSetting(db, { userUid, key: HYDRATION_KEY_ACTIVE_START, value: activeStart, ...opts })
  writeUserSetting(db, { userUid, key: HYDRATION_KEY_ACTIVE_END, value: activeEnd, ...opts })
  writeUserSetting(db, { userUid, key: HYDRATION_KEY_GLASS_SIZE, value: String(glassSize), ...opts })

  return getHydrationConfig(db, userUid)
}

export function setHydrationLastNudgeAt(
  db: Database.Database,
  userUid: string,
  epochMs: number,
): void {
  writeUserSetting(db, {
    userUid,
    key: HYDRATION_KEY_LAST_NUDGE_AT,
    value: String(epochMs),
    audit: false,
  })
}

export function hydrationLastNudgeAtFromStored(stored: HydrationStored): number | null {
  return parseLastNudgeAt(stored[HYDRATION_KEY_LAST_NUDGE_AT])
}

export function setHydrationLastRecordAt(
  db: Database.Database,
  userUid: string,
  epochMs: number,
): void {
  writeUserSetting(db, {
    userUid,
    key: HYDRATION_KEY_LAST_RECORD_AT,
    value: String(epochMs),
    audit: false,
  })
}

export function hydrationLastRecordAtFromStored(stored: HydrationStored): number | null {
  return parseEpochMs(stored[HYDRATION_KEY_LAST_RECORD_AT])
}

export function hydrationMutedUntilFromStored(stored: HydrationStored): string | null {
  return parseMutedUntilYmd(stored[HYDRATION_KEY_MUTED_UNTIL])
}

/** True when mute covers localTodayYmd (inclusive; expires at next local midnight). */
export function isHydrationMutedForLocalDay(
  mutedUntilYmd: string | null | undefined,
  localTodayYmd: string,
): boolean {
  if (!mutedUntilYmd) return false
  return mutedUntilYmd >= localTodayYmd
}

export function setHydrationMutedForLocalDay(
  db: Database.Database,
  userUid: string,
  localTodayYmd: string,
  writeOpts?: HydrationUserSettingWriteOptions,
): void {
  writeUserSetting(db, {
    userUid,
    key: HYDRATION_KEY_MUTED_UNTIL,
    value: localTodayYmd,
    actorEmail: writeOpts?.actorEmail,
    audit: writeOpts?.audit,
  })
}
