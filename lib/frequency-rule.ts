// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import type { FrequencyRule } from "./domain-types"
import { convertObservationValue } from "./observation/observation-unit-conversion"

export type { FrequencyRule }

/** When true, max_quantity_per_24h is compared to administration count, not summed dosage. */
export function ruleMax24hIsDoseCount(rule: FrequencyRule | null | undefined): boolean {
  if (!rule) return false
  return Number((rule as { max_per_24h_count_doses?: number }).max_per_24h_count_doses) === 1
}

export function ruleHasWeightBand(r: FrequencyRule | null): boolean {
  if (!r) return false
  return r.min_weight_kg != null || r.max_weight_kg != null
}

function matchesWeightBand(r: FrequencyRule, weightKg: number | null): boolean {
  if (!ruleHasWeightBand(r)) return true
  if (weightKg == null) return false
  if (r.min_weight_kg != null && weightKg < r.min_weight_kg) return false
  if (r.max_weight_kg != null && weightKg > r.max_weight_kg) return false
  return true
}

function matchesAgeBand(r: FrequencyRule, ageYears: number | null): boolean {
  if (ageYears === null) return true
  const hasAge = r.min_age_years !== null || r.max_age_years !== null
  if (!hasAge) return true
  return (
    (r.min_age_years === null || ageYears >= r.min_age_years) &&
    (r.max_age_years === null || ageYears <= r.max_age_years)
  )
}

/** Distance outside age band; 0 if inside or rule has no age band. */
function ageBandDistance(r: FrequencyRule, ageYears: number): number {
  if (r.min_age_years === null && r.max_age_years === null) return 0
  const lo = r.min_age_years ?? -Infinity
  const hi = r.max_age_years ?? Infinity
  if (ageYears >= lo && ageYears <= hi) return 0
  if (ageYears < lo) return lo - ageYears
  return ageYears - hi
}

/** Distance from weight (kg) to the rule's band; 0 inside or if the rule has no band. */
function weightBandDistance(r: FrequencyRule, weightKg: number): number {
  if (!ruleHasWeightBand(r)) return 0
  const lo = r.min_weight_kg ?? -Infinity
  const hi = r.max_weight_kg ?? Infinity
  if (weightKg >= lo && weightKg <= hi) return 0
  if (weightKg < lo) return lo - weightKg
  return weightKg - hi
}

function narrowestAgeRule(a: FrequencyRule, b: FrequencyRule): FrequencyRule {
  const bestBand = (a.max_age_years ?? 200) - (a.min_age_years ?? 0)
  const rBand = (b.max_age_years ?? 200) - (b.min_age_years ?? 0)
  return rBand < bestBand ? b : a
}

function pickNarrowestAge(rules: FrequencyRule[]): FrequencyRule {
  return rules.reduce((a, b) => narrowestAgeRule(a, b))
}

/**
 * From a pre-fetched list of rules, selects the best match for the given
 * age and weight. Weight bands take priority; within them, the narrowest
 * age band wins. Falls back gracefully when bands don't match exactly.
 */
export function findRuleFromList(
  rules: FrequencyRule[],
  ageYears: number | null,
  weightKg: number | null,
): FrequencyRule | null {
  if (!rules.length) return null

  const fitsWeight = rules.filter(r => matchesWeightBand(r, weightKg))
  if (fitsWeight.length > 0) {
    const ageOk = fitsWeight.filter(r => matchesAgeBand(r, ageYears))
    if (ageOk.length === 1) return ageOk[0]
    if (ageOk.length > 1) return pickNarrowestAge(ageOk)
    if (ageYears != null) {
      return fitsWeight.reduce((best, r) => {
        const db = ageBandDistance(best, ageYears)
        const dr = ageBandDistance(r, ageYears)
        if (dr < db) return r
        if (dr > db) return best
        return narrowestAgeRule(best, r)
      })
    }
    return fitsWeight.length === 1 ? fitsWeight[0] : pickNarrowestAge(fitsWeight)
  }

  const ageMatching =
    ageYears !== null
      ? rules.filter(
          r =>
            (r.min_age_years !== null || r.max_age_years !== null) &&
            (r.min_age_years === null || ageYears >= r.min_age_years) &&
            (r.max_age_years === null || ageYears <= r.max_age_years),
        )
      : []
  const generic = rules.filter(r => r.min_age_years === null && r.max_age_years === null)
  const byAge = ageMatching.length > 0 ? ageMatching : generic
  if (!byAge.length) return null

  const candidates = byAge.filter(r => matchesWeightBand(r, weightKg))
  if (candidates.length === 1) return candidates[0]
  if (candidates.length > 1) return pickNarrowestAge(candidates)

  if (byAge.length === 1 && weightKg != null) return byAge[0]
  if (weightKg == null) return null

  return byAge.reduce((best, r) => {
    const db = weightBandDistance(best, weightKg)
    const dr = weightBandDistance(r, weightKg)
    if (dr < db) return r
    if (dr > db) return best
    return narrowestAgeRule(best, r)
  })
}

/** Latest weight in kg for limit/rule matching; converts lb if needed. */
export function getLatestPersonWeightKg(db: Database.Database, personId: number): number | null {
  const row = db.prepare(
    `SELECT value, unit FROM observations
     WHERE person_id = ? AND observation_type = 'Weight'
     ORDER BY recorded_at DESC LIMIT 1`
  ).get(personId) as { value: number; unit: string } | undefined
  if (!row) return null
  const kg = convertObservationValue(row.value, row.unit, "kg", "Weight")
  return kg
}

/**
 * Resolves the dosing-frequency rule for a medication.
 *
 * Medication-scoped rules only. Group-scoped dosing rules were retired;
 * medication groups remain solely as active-ingredient tags for the trailing-24h
 * administration history (see `getGroupSiblingIds`), not a vessel for dosing rules.
 */
export function getApplicableFrequencyRule(
  db: Database.Database,
  medicationId: number,
  personAge: number | null,
  personWeightKg: number | null = null
): FrequencyRule | null {
  const medRules = db.prepare(
    `SELECT * FROM medication_frequency_rules WHERE medication_id = ?
     ORDER BY COALESCE(min_age_years, -1), min_hours_between`
  ).all(medicationId) as FrequencyRule[]

  return findRuleFromList(medRules, personAge, personWeightKg)
}

/** All medication IDs in the same group(s) as medicationId, including itself. */
export function getGroupSiblingIds(db: Database.Database, medicationId: number): number[] {
  const rows = db.prepare(
    `SELECT DISTINCT mgm2.medication_id
       FROM medication_group_members mgm2
      WHERE mgm2.group_id IN (
        SELECT group_id FROM medication_group_members WHERE medication_id = ?
      )`
  ).all(medicationId) as { medication_id: number }[]
  const ids = new Set(rows.map(r => r.medication_id))
  ids.add(medicationId)
  return [...ids]
}

/**
 * Bulk variant of getGroupSiblingIds — resolves sibling sets for many medication IDs in two
 * queries instead of one round-trip per medication (group membership doesn't vary by person).
 */
export function getGroupSiblingIdsBulk(
  db: Database.Database,
  medicationIds: number[],
): Map<number, number[]> {
  const result = new Map<number, number[]>()
  const ids = [...new Set(medicationIds)]
  if (ids.length === 0) return result
  for (const id of ids) result.set(id, [id])

  const idPh = ids.map(() => "?").join(",")
  const groupRows = db
    .prepare(`SELECT medication_id, group_id FROM medication_group_members WHERE medication_id IN (${idPh})`)
    .all(...ids) as { medication_id: number; group_id: number }[]
  if (groupRows.length === 0) return result

  const groupIds = [...new Set(groupRows.map(r => r.group_id))]
  const groupPh = groupIds.map(() => "?").join(",")
  const memberRows = db
    .prepare(`SELECT medication_id, group_id FROM medication_group_members WHERE group_id IN (${groupPh})`)
    .all(...groupIds) as { medication_id: number; group_id: number }[]

  const membersByGroup = new Map<number, number[]>()
  for (const r of memberRows) {
    const arr = membersByGroup.get(r.group_id)
    if (arr) arr.push(r.medication_id)
    else membersByGroup.set(r.group_id, [r.medication_id])
  }
  const groupsByMed = new Map<number, number[]>()
  for (const r of groupRows) {
    const arr = groupsByMed.get(r.medication_id)
    if (arr) arr.push(r.group_id)
    else groupsByMed.set(r.medication_id, [r.group_id])
  }

  for (const id of ids) {
    const siblingSet = new Set<number>([id])
    for (const gid of groupsByMed.get(id) ?? []) {
      for (const m of membersByGroup.get(gid) ?? []) siblingSet.add(m)
    }
    result.set(id, [...siblingSet])
  }
  return result
}

/**
 * Parses JSON body `min_hours_between` for frequency-rule APIs.
 * `0` means no minimum interval between doses (as required / PRN).
 */
export function parseMinHoursBetweenFromApi(
  raw: unknown
): { ok: true; value: number } | { ok: false; message: string } {
  if (raw === undefined || raw === null) {
    return { ok: false, message: "min_hours_between is required" }
  }
  const n = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, message: "min_hours_between must be a non-negative number" }
  }
  return { ok: true, value: n }
}
