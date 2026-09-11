// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { tzLocalYmdAndOffset } from "@/lib/datetime"
import { isValidIanaTz, SETTING_LOCALE_DEFAULT_TIMEZONE } from "@/lib/settings/registry"
import { resolveSetting } from "@/lib/settings/resolver"

/** Instance-wide IANA timezone from env or `app_settings` (Layer C). */
export function resolveInstanceTimezone(db: Database.Database): string | null {
  const { value } = resolveSetting(db, SETTING_LOCALE_DEFAULT_TIMEZONE)
  const trimmed = value.trim()
  if (trimmed === "" || !isValidIanaTz(trimmed)) return null
  return trimmed
}

/**
 * IANA timezone for person-age birthday boundaries: instance default, or `UTC` when unset/invalid.
 * Pass the result as the required `timeZone` argument to `fractionalAgeYears` / `completedCalendarYears`.
 */
export function resolveAgeTimezone(db: Database.Database): string {
  return resolveInstanceTimezone(db) ?? "UTC"
}

/** Returns an error when a non-null tz string is not a valid IANA name. */
export function validateScheduleIanaTz(
  tz: string | null,
): { ok: true; tz: string | null } | { ok: false; error: string } {
  if (tz == null || tz === "") return { ok: true, tz: null }
  if (!isValidIanaTz(tz)) return { ok: false, error: "Invalid timezone" }
  return { ok: true, tz }
}

/** Persisted schedule tz on write: body IANA when present, else instance default. */
export function resolveScheduleTzForWrite(
  bodyTz: unknown,
  db: Database.Database,
): string | null {
  if (typeof bodyTz === "string" && bodyTz.trim() !== "") {
    return bodyTz.trim()
  }
  return resolveInstanceTimezone(db)
}

/**
 * Person-medication PATCH: explicit body `tz` wins; when schedule stays active and `tz` is
 * omitted, fill instance default or keep existing row tz.
 */
export function resolvePersonMedicationScheduleTzForPatch(
  body: Record<string, unknown>,
  existingScheduleTz: string | null,
  scheduleActive: boolean,
  db: Database.Database,
): string | null {
  if ("tz" in body) {
    return typeof body.tz === "string" && body.tz.trim() !== "" ? body.tz.trim() : null
  }
  if (!scheduleActive) return existingScheduleTz
  return resolveScheduleTzForWrite(undefined, db) ?? existingScheduleTz
}

/** Per-row IANA when set, otherwise instance default. */
export function resolveEffectiveIanaTz(
  rowIanaTz: string | null | undefined,
  db: Database.Database,
): string | null {
  const row = rowIanaTz?.trim()
  if (row && isValidIanaTz(row)) return row
  return resolveInstanceTimezone(db)
}

/** Offset for history slot matching: row/instance IANA at record time, else client offset. */
export function resolveSlotMatchOffsetMinutes(
  recordedAtMs: number,
  scheduleTz: string | null | undefined,
  clientOffsetMinutes: number,
  db: Database.Database,
): number {
  const iana = resolveEffectiveIanaTz(scheduleTz, db)
  if (iana) {
    return tzLocalYmdAndOffset(recordedAtMs, iana).offsetMinutes
  }
  return clientOffsetMinutes
}
