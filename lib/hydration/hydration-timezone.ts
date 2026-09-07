// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { tzLocalYmdAndOffset } from "@/lib/datetime"
import { resolveInstanceTimezone } from "@/lib/instance-timezone"
import { isValidIanaTz } from "@/lib/settings/registry"
import { writeUserSetting, type UserSettingWriteOpts } from "@/lib/settings/user-settings-store"

/** Per-user IANA timezone in `user_settings` (hydration / server-initiated local day). */
export const USER_TIMEZONE_KEY = "locale.timezone"

export type HydrationTzSource = "user" | "instance" | "fallback"

export interface ResolvedHydrationTz {
  tz: string | null
  source: HydrationTzSource
}

export interface ResolvedHydrationLocalDay extends ResolvedHydrationTz {
  ymd: string
  offsetMinutes: number
}

/**
 * Server-initiated hydration timezone precedence (cron, push, mute local-day):
 * 1. Per-user `locale.timezone` in `user_settings` when valid IANA → `source: "user"`
 * 2. Instance `locale.default_timezone` (env or `app_settings`) → `source: "instance"`
 * 3. Unresolvable → `source: "fallback"`, `tz: null` (suppress hydration push for that user)
 */
export function resolveHydrationTimezone(
  db: Database.Database,
  options?: { userUid?: string | null; userTz?: string | null },
): ResolvedHydrationTz {
  const userUid = options?.userUid?.trim()
  let userTz = options?.userTz
  if (userTz === undefined && userUid) {
    userTz = getUserHydrationTimezone(db, userUid) ?? undefined
  }

  const trimmedUser = typeof userTz === "string" ? userTz.trim() : ""
  if (trimmedUser !== "" && isValidIanaTz(trimmedUser)) {
    return { tz: trimmedUser, source: "user" }
  }

  const instanceTz = resolveInstanceTimezone(db)
  if (instanceTz) return { tz: instanceTz, source: "instance" }

  return { tz: null, source: "fallback" }
}

/** Local calendar day in the resolved hydration timezone (for mute expiry, day totals). */
export function resolveHydrationLocalDay(
  db: Database.Database,
  userUid: string,
  nowMs: number,
  options?: { userTz?: string | null },
): ResolvedHydrationLocalDay | null {
  const resolved = resolveHydrationTimezone(db, { userUid, userTz: options?.userTz })
  if (!resolved.tz) return null
  const { ymd, offsetMinutes } = tzLocalYmdAndOffset(nowMs, resolved.tz)
  return { ...resolved, ymd, offsetMinutes }
}

export function getUserHydrationTimezone(
  db: Database.Database,
  userUid: string,
): string | null {
  const trimmed = userUid.trim()
  if (trimmed === "") return null
  const row = db
    .prepare("SELECT value FROM user_settings WHERE user_uid = ? AND key = ?")
    .get(trimmed, USER_TIMEZONE_KEY) as { value: string } | undefined
  if (!row) return null
  const value = row.value.trim()
  return value === "" ? null : value
}

/** Read stored timezone from write uid, then linked candidates. */
export function getUserHydrationTimezoneForCandidateUids(
  db: Database.Database,
  writeUid: string,
  candidateUids: string[],
): string | null {
  const ordered = [writeUid, ...candidateUids]
  const seen = new Set<string>()
  for (const uid of ordered) {
    const trimmed = uid.trim()
    if (trimmed === "" || seen.has(trimmed)) continue
    seen.add(trimmed)
    const tz = getUserHydrationTimezone(db, trimmed)
    if (tz) return tz
  }
  return null
}

export function setUserHydrationTimezone(
  db: Database.Database,
  userUid: string,
  timezone: string | null,
  writeOpts?: UserSettingWriteOpts,
): void {
  const trimmedUid = userUid.trim()
  if (trimmedUid === "") throw new Error("userUid is required")

  const trimmedTz = timezone?.trim() ?? ""
  if (trimmedTz === "") {
    writeUserSetting(db, {
      userUid: trimmedUid,
      key: USER_TIMEZONE_KEY,
      value: null,
      actorEmail: writeOpts?.actorEmail,
      audit: writeOpts?.audit,
    })
    return
  }
  if (!isValidIanaTz(trimmedTz)) throw new Error("Invalid timezone")

  writeUserSetting(db, {
    userUid: trimmedUid,
    key: USER_TIMEZONE_KEY,
    value: trimmedTz,
    actorEmail: writeOpts?.actorEmail,
    audit: writeOpts?.audit,
  })
}

export function loadUserHydrationTimezonesForUserUids(
  db: Database.Database,
  userUids: string[],
): Map<string, string> {
  const unique = [...new Set(userUids.map(uid => uid.trim()).filter(uid => uid !== ""))]
  const out = new Map<string, string>()
  if (unique.length === 0) return out

  const rows = db
    .prepare(
      `SELECT user_uid, value FROM user_settings
       WHERE user_uid IN (${unique.map(() => "?").join(",")})
         AND key = ?`,
    )
    .all(...unique, USER_TIMEZONE_KEY) as { user_uid: string; value: string }[]

  for (const row of rows) {
    const value = row.value.trim()
    if (value !== "") out.set(row.user_uid, value)
  }
  return out
}

/** Prefer write uid timezone, then any linked candidate with a stored value. */
export function resolveHydrationTimezoneForCandidates(
  options: {
    writeUid?: string | null
    candidateUids: string[]
    userTzByUid: Map<string, string>
  },
): string | undefined {
  const writeUid = options.writeUid?.trim()
  if (writeUid) {
    const writeTz = options.userTzByUid.get(writeUid)
    if (writeTz) return writeTz
  }
  for (const uid of options.candidateUids) {
    const trimmed = uid.trim()
    if (trimmed === "") continue
    const tz = options.userTzByUid.get(trimmed)
    if (tz) return tz
  }
  return undefined
}
