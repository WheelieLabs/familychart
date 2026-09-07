// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { fractionalAgeYears } from "@/lib/person/person-age"
import { resolveAgeTimezone } from "@/lib/instance-timezone"
import { MEDICATION_DOSAGE_UNITS, normaliseMedicationDosageUnitAlias } from "@/lib/medication/medication-units"

export interface MedicationRecordWriteInput {
  medication_id: number
  recorded_at: unknown
  dosage?: unknown
  dosage_unit?: unknown
  /**
   * Person the dose is recorded against. When set, the write is checked against the
   * person↔medication link and the medication's age bounds (see options below).
   */
  person_id?: number
}

export interface MedicationRecordWriteOptions {
  /**
   * Require an active `person_medications` row linking the person to the medication
   * (defaults to true when `person_id` is supplied). Interactive POST/PATCH enforce it;
   * the manager-only spreadsheet import disables it because it assigns/creates history.
   */
  requirePersonLink?: boolean
}

export interface MedicationRecordWriteFields {
  recordedAt: string
  dosage: number | null
  dosageUnit: string | null
  /** True when the recorded unit differs from the medication's catalogue unit — the dose
   *  still saves, but won't count toward that medication's unit-scoped 24h cap. */
  dosageUnitMismatch: boolean
}

/** Max accepted dosage magnitude; rejects absurd values that could abuse the 24h-cap SUM. */
export const MAX_MEDICATION_DOSAGE = 1_000_000
/** Clock skew tolerated for a "now" dose recorded against a slightly-ahead client clock. */
const FUTURE_SKEW_MS = 5 * 60_000
/** Floor to reject garbage timestamps without rejecting genuinely backdated history. */
const MIN_RECORDED_AT_MS = Date.UTC(1900, 0, 1)

/**
 * Validates and normalises a medication-record write (POST/PATCH/import).
 *
 * The dose write path feeds dashboard 24h-cap and PRN-cooldown **alerts and reminders**
 * caregivers rely on, so each field is bounded for alert accuracy (not clinical enforcement —
 * see ADR-0011):
 * - medication must exist and be active;
 * - recorded_at must parse, not be in the future beyond a small skew, nor implausibly old
 *   (future-dating otherwise becomes the "last dose" and suppresses a legitimate reminder);
 * - dosage is optional (dose-count tracking) but, when present, must be finite, positive and
 *   in range (a negative/zero dosage would cancel the quantity-mode rolling-24h total SUM);
 * - dosage_unit is accepted as provided (aliases normalised to the canonical catalogue
 *   spelling, e.g. "tabs" -> "Tabs"); when it differs from the medication's catalogue unit,
 *   the write still succeeds — `dosageUnitMismatch` comes back true so callers can surface
 *   that this dose won't count toward that medication's unit-scoped 24h total
 *   (`mr.dosage_unit = <catalogue>`, case-sensitive in SQLite). Per ADR-0011, alert-accuracy
 *   concerns are never a reason to block a caregiver from recording what actually happened;
 * - when `person_id` is supplied, the medication must be linked to the person via an active
 *   `person_medications` row (unless `requirePersonLink` is false) and must satisfy the
 *   medication's `min_age_years`/`max_age_years` bounds against the person's date of birth.
 *
 * Cooldown (`min_hours_between`) and 24h caps (`max_quantity_per_24h`) are **not** write
 * gates here or on PATCH/import — they remain dashboard/cron alert inputs only.
 */
/** Validates `recorded_at` in isolation (no catalogue lookup) so callers can reject a row
 *  before creating any medication catalogue entry. */
export function validateRecordTiming(
  recordedAtRaw: unknown,
): { ok: true; recordedAt: string } | { ok: false; error: string } {
  if (typeof recordedAtRaw !== "string" || recordedAtRaw.trim() === "") {
    return { ok: false, error: "recorded_at is required" }
  }
  const recordedMs = new Date(recordedAtRaw).getTime()
  if (!Number.isFinite(recordedMs)) {
    return { ok: false, error: "recorded_at is not a valid date" }
  }
  if (recordedMs > Date.now() + FUTURE_SKEW_MS) {
    return { ok: false, error: "recorded_at cannot be in the future" }
  }
  if (recordedMs < MIN_RECORDED_AT_MS) {
    return { ok: false, error: "recorded_at is implausibly old" }
  }
  return { ok: true, recordedAt: recordedAtRaw }
}

/** Validates an optional dosage magnitude in isolation (no catalogue lookup). */
export function validateRecordDosage(
  rawDosage: unknown,
): { ok: true; dosage: number | null } | { ok: false; error: string } {
  if (rawDosage == null) return { ok: true, dosage: null }
  const numeric =
    typeof rawDosage === "number"
      ? rawDosage
      : typeof rawDosage === "string" && rawDosage.trim() !== ""
        ? Number(rawDosage)
        : NaN
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { ok: false, error: "dosage must be a positive number" }
  }
  if (numeric > MAX_MEDICATION_DOSAGE) {
    return { ok: false, error: "dosage is out of range" }
  }
  return { ok: true, dosage: numeric }
}

export function validateMedicationRecordWrite(
  db: Database.Database,
  input: MedicationRecordWriteInput,
  options: MedicationRecordWriteOptions = {},
): ({ ok: true } & MedicationRecordWriteFields) | { ok: false; error: string } {
  const med = db
    .prepare(
      "SELECT dosage_unit, min_age_years, max_age_years FROM medications WHERE id = ? AND is_active = 1",
    )
    .get(input.medication_id) as
    | { dosage_unit: string | null; min_age_years: number | null; max_age_years: number | null }
    | undefined
  if (!med) {
    return { ok: false, error: "Unknown or inactive medication" }
  }

  if (input.person_id != null) {
    const linkCheck = validatePersonMedicationLinkage(db, input, med, options)
    if (linkCheck) return linkCheck
  }

  const timing = validateRecordTiming(input.recorded_at)
  if (!timing.ok) return timing
  const recordedAtRaw = timing.recordedAt

  const dosageResult = validateRecordDosage(input.dosage)
  if (!dosageResult.ok) return dosageResult
  const dosage = dosageResult.dosage

  const catalogueUnit = med.dosage_unit?.trim() || null
  const providedUnitRaw =
    typeof input.dosage_unit === "string" ? input.dosage_unit.trim() : ""
  let dosageUnit: string | null
  let dosageUnitMismatch = false
  if (providedUnitRaw === "") {
    dosageUnit = catalogueUnit
  } else {
    const providedUnit = normaliseMedicationDosageUnitAlias(providedUnitRaw)
    const matchesCatalogue = catalogueUnit != null && providedUnit.toLowerCase() === catalogueUnit.toLowerCase()
    // Must match the catalogue unit exactly, or else be a recognised catalogue unit in its
    // own right — this still catches typos/garbage, it just no longer requires the unit to
    // be *this medication's particular* default. Recording history must never fail just
    // because a genuinely valid unit differs from the default (ADR-0011); the write still
    // succeeds, but won't count toward this medication's unit-scoped 24h cap
    // (`mr.dosage_unit = <catalogue>`), so callers surface the mismatch instead.
    if (!matchesCatalogue && !(MEDICATION_DOSAGE_UNITS as readonly string[]).includes(providedUnit)) {
      return { ok: false, error: `dosage_unit "${providedUnitRaw}" is not a recognised unit` }
    }
    dosageUnit = matchesCatalogue ? catalogueUnit! : providedUnit
    dosageUnitMismatch = catalogueUnit != null && !matchesCatalogue
  }

  return { ok: true, recordedAt: recordedAtRaw, dosage, dosageUnit, dosageUnitMismatch }
}

/**
 * Verifies the medication is prescribed to the person (active `person_medications` link)
 * and that the person meets the medication's age bounds. Returns an error result to abort,
 * or null when the linkage is acceptable. Used by POST/PATCH (link required) and import
 * (age only) — see {@link MedicationRecordWriteOptions}.
 */
function validatePersonMedicationLinkage(
  db: Database.Database,
  input: MedicationRecordWriteInput,
  med: { min_age_years: number | null; max_age_years: number | null },
  options: MedicationRecordWriteOptions,
): { ok: false; error: string } | null {
  const personId = input.person_id
  if (personId == null) return null

  if (options.requirePersonLink !== false) {
    const link = db
      .prepare(
        "SELECT 1 FROM person_medications WHERE person_id = ? AND medication_id = ? AND is_active = 1 LIMIT 1",
      )
      .get(personId, input.medication_id)
    if (!link) {
      return { ok: false, error: "Medication is not assigned to this person" }
    }
  }

  if (med.min_age_years != null || med.max_age_years != null) {
    const person = db
      .prepare("SELECT date_of_birth FROM people WHERE id = ? AND is_active = 1")
      .get(personId) as { date_of_birth: string | null } | undefined
    if (person?.date_of_birth) {
      const age = fractionalAgeYears(person.date_of_birth, resolveAgeTimezone(db))
      if (Number.isFinite(age)) {
        if (med.min_age_years != null && age < med.min_age_years) {
          return { ok: false, error: "Person is below the minimum age for this medication" }
        }
        if (med.max_age_years != null && age > med.max_age_years) {
          return { ok: false, error: "Person is above the maximum age for this medication" }
        }
      }
    }
  }

  return null
}
