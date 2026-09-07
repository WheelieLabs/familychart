// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { fractionalAgeYears } from "@/lib/person/person-age"
import { resolveAgeTimezone, resolveScheduleTzForWrite } from "@/lib/instance-timezone"
import { isValidIanaTz } from "@/lib/settings/registry"
import { findObservationTypeConfig } from "@/lib/observation/observation-type-meta"
import type { ObservationCadence, PersonObservationExpectationRow } from "@/lib/observation/observation-recurrence"
import { parseScheduleTimeUserInput } from "@/lib/datetime"

const CADENCES: ObservationCadence[] = ["daily", "weekly", "monthly", "yearly", "custom_days"]

export type ValidatedObservationExpectation = Omit<
  PersonObservationExpectationRow,
  "id" | "person_id"
>

export type ObservationExpectationValidationResult =
  | { ok: true; row: ValidatedObservationExpectation }
  | { ok: false; error: string }

function isCadence(s: string): s is ObservationCadence {
  return (CADENCES as string[]).includes(s)
}

function err(message: string): ObservationExpectationValidationResult {
  return { ok: false, error: message }
}

export function validateObservationExpectation(
  db: Database.Database,
  raw: Record<string, unknown>,
  dateOfBirth: string | null,
): ObservationExpectationValidationResult {
  const observation_type = typeof raw.observation_type === "string" ? raw.observation_type.trim() : ""
  const cfg = findObservationTypeConfig(db, observation_type)
  if (!cfg) {
    return err("Invalid Observation Type")
  }
  if (cfg.max_age_years != null && dateOfBirth && dateOfBirth.trim() !== "") {
    const ay = fractionalAgeYears(dateOfBirth, resolveAgeTimezone(db))
    if (ay > cfg.max_age_years) {
      return err("Observation Type does not apply to this person's age")
    }
  }
  const cadenceStr = typeof raw.cadence === "string" ? raw.cadence.trim() : ""
  if (!isCadence(cadenceStr)) {
    return err("Invalid cadence")
  }
  const cadence = cadenceStr
  const enabled = raw.enabled === false || raw.enabled === 0 ? 0 : 1
  let recurrence_use_birthday =
    raw.recurrence_use_birthday === true || raw.recurrence_use_birthday === 1 ? 1 : 0

  let interval_days: number | null =
    typeof raw.interval_days === "number" && Number.isFinite(raw.interval_days)
      ? raw.interval_days
      : raw.interval_days != null && raw.interval_days !== ""
        ? parseFloat(String(raw.interval_days))
        : null
  if (interval_days != null && !Number.isFinite(interval_days)) interval_days = null

  let recurrence_day_of_month: number | null =
    typeof raw.recurrence_day_of_month === "number" ? raw.recurrence_day_of_month : null
  if (
    recurrence_day_of_month == null &&
    raw.recurrence_day_of_month != null &&
    raw.recurrence_day_of_month !== ""
  ) {
    recurrence_day_of_month = parseInt(String(raw.recurrence_day_of_month), 10)
  }
  if (
    recurrence_day_of_month != null &&
    (!Number.isFinite(recurrence_day_of_month) ||
      recurrence_day_of_month < 1 ||
      recurrence_day_of_month > 31)
  ) {
    return err("Invalid recurrence_day_of_month")
  }

  let recurrence_month: number | null =
    typeof raw.recurrence_month === "number" ? raw.recurrence_month : null
  if (recurrence_month == null && raw.recurrence_month != null && raw.recurrence_month !== "") {
    recurrence_month = parseInt(String(raw.recurrence_month), 10)
  }
  if (
    recurrence_month != null &&
    (!Number.isFinite(recurrence_month) || recurrence_month < 1 || recurrence_month > 12)
  ) {
    return err("Invalid recurrence_month")
  }

  let recurrence_day: number | null =
    typeof raw.recurrence_day === "number" ? raw.recurrence_day : null
  if (recurrence_day == null && raw.recurrence_day != null && raw.recurrence_day !== "") {
    recurrence_day = parseInt(String(raw.recurrence_day), 10)
  }
  if (
    recurrence_day != null &&
    (!Number.isFinite(recurrence_day) || recurrence_day < 1 || recurrence_day > 31)
  ) {
    return err("Invalid recurrence_day")
  }

  if (cadence === "weekly" || cadence === "custom_days") {
    if (interval_days == null || interval_days <= 0) {
      return err("interval_days required for weekly and custom_days")
    }
  } else {
    interval_days = null
  }

  if (cadence === "monthly") {
    if (recurrence_use_birthday) {
      if (!dateOfBirth || dateOfBirth.trim() === "") {
        return err("Date of birth required for birthday-based monthly recurrence")
      }
      recurrence_day_of_month = null
    } else {
      if (recurrence_day_of_month == null) {
        return err("recurrence_day_of_month required for monthly cadence")
      }
    }
    recurrence_month = null
    recurrence_day = null
  }

  if (cadence === "yearly") {
    if (recurrence_use_birthday) {
      if (!dateOfBirth || dateOfBirth.trim() === "") {
        return err("Date of birth required for birthday-based yearly recurrence")
      }
      recurrence_month = null
      recurrence_day = null
    } else {
      if (recurrence_month == null || recurrence_day == null) {
        return err("recurrence_month and recurrence_day required for yearly cadence")
      }
    }
    recurrence_day_of_month = null
  }

  if (cadence === "daily") {
    recurrence_day_of_month = null
    recurrence_month = null
    recurrence_day = null
    recurrence_use_birthday = 0
  }

  let due_time_hhmm = "00:00"
  if (raw.due_time_hhmm != null && String(raw.due_time_hhmm).trim() !== "") {
    const normalized =
      typeof raw.due_time_hhmm === "string"
        ? parseScheduleTimeUserInput(raw.due_time_hhmm.trim())
        : null
    if (!normalized) return err("Invalid due_time_hhmm")
    due_time_hhmm = normalized
  }

  let tz = typeof raw.tz === "string" && raw.tz.trim() !== "" ? raw.tz.trim() : null
  if (enabled && tz == null) {
    tz = resolveScheduleTzForWrite(undefined, db)
  }
  if (tz != null && !isValidIanaTz(tz)) {
    return err("Invalid timezone")
  }

  return {
    ok: true,
    row: {
      observation_type,
      cadence,
      interval_days,
      recurrence_day_of_month:
        recurrence_use_birthday && (cadence === "monthly" || cadence === "yearly")
          ? null
          : recurrence_day_of_month,
      recurrence_month: recurrence_use_birthday && cadence === "yearly" ? null : recurrence_month,
      recurrence_day: recurrence_use_birthday && cadence === "yearly" ? null : recurrence_day,
      recurrence_use_birthday:
        cadence === "monthly" || cadence === "yearly" ? recurrence_use_birthday : 0,
      enabled,
      due_time_hhmm,
      tz,
    },
  }
}

/** Merge PATCH body onto an existing row for full re-validation. */
export function mergeExpectationPatch(
  existing: PersonObservationExpectationRow,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    observation_type: existing.observation_type,
    cadence: existing.cadence,
    enabled: existing.enabled === 1,
    interval_days: existing.interval_days,
    recurrence_day_of_month: existing.recurrence_day_of_month,
    recurrence_month: existing.recurrence_month,
    recurrence_day: existing.recurrence_day,
    recurrence_use_birthday: existing.recurrence_use_birthday === 1,
    due_time_hhmm: existing.due_time_hhmm ?? "00:00",
    tz: existing.tz ?? null,
  }
  const keys = [
    "observation_type",
    "cadence",
    "enabled",
    "interval_days",
    "recurrence_day_of_month",
    "recurrence_month",
    "recurrence_day",
    "recurrence_use_birthday",
    "due_time_hhmm",
    "tz",
  ] as const
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(body, k)) base[k] = body[k]
  }
  return base
}
