// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import type { FrequencyRule } from "@/lib/domain-types"
import {
  findRuleFromList,
  getGroupSiblingIdsBulk,
  getLatestPersonWeightKg,
  ruleMax24hIsDoseCount,
} from "@/lib/frequency-rule"
import { fractionalAgeYears } from "@/lib/person/person-age"
import { resolveAgeTimezone } from "@/lib/instance-timezone"
import {
  getLastGroupDoseWithOffset,
  getLastRecordedDosageForMed,
} from "@/lib/dashboard/dashboard-dose-queries"
import type { MedicationDoseSlice } from "@/lib/prn/prn-eval"

/** How far back the bulk last-dose/last-dosage query looks before falling back to a per-pair query. */
const LAST_DOSE_LOOKBACK_DAYS = 90

type RecentDoseRow = {
  person_id: number
  medication_id: number
  recorded_at: string
  dosage: number | null
  dosage_unit: string | null
  remind_after_hours: number | null
  med_name: string | null
}

export type { MedicationDoseSlice, PrnEvalResult } from "@/lib/prn/prn-eval"
export { evaluatePrnState } from "@/lib/prn/prn-eval"

/** All dose-state maps for a set of people; built once per request or cron tick. */
export interface MedicationDoseStateMaps {
  /** Meds that need PRN state: active person_medications + recently dosed meds. */
  frequencyMedIdsByPerson: Map<number, Set<number>>
  /** Applicable frequency rule keyed by `${personId}:${medicationId}`. */
  ruleByPersonMed: Map<string, FrequencyRule | null>
  /** Rolling 24h dose total per key. */
  total24hByPersonMed: Map<string, number>
  /** Oldest dose in the 24h window per key; null when no cap is configured. */
  oldest24hByPersonMed: Map<string, string | null>
  /** Latest dose with PRN remind offset and sibling med name per key (respects group siblings). */
  lastDoseByPersonMed: Map<string, { lastIso: string; remindAfterHours: number | null; lastMedName: string | null } | null>
  /** Last recorded dosage amount per key; fallback for quantity-mode caps. */
  lastDosageByPersonMed: Map<string, number | null>
  /** Medication catalogue default dosage per medicationId. */
  catalogDefaultDosageByMed: Map<number, number | null>
}

/** Extract a slice from maps for a single (person, medication) pair. */
export function doseSliceFromMaps(
  maps: Pick<
    MedicationDoseStateMaps,
    | "ruleByPersonMed"
    | "total24hByPersonMed"
    | "lastDoseByPersonMed"
    | "oldest24hByPersonMed"
    | "lastDosageByPersonMed"
    | "catalogDefaultDosageByMed"
  >,
  personId: number,
  medId: number,
): MedicationDoseSlice {
  const key = `${personId}:${medId}`
  return {
    rule: maps.ruleByPersonMed.get(key) ?? null,
    total24h: maps.total24hByPersonMed.get(key) ?? 0,
    lastDose: maps.lastDoseByPersonMed.get(key) ?? null,
    oldest24h: maps.oldest24hByPersonMed.get(key) ?? null,
    lastDosage: maps.lastDosageByPersonMed.get(key) ?? null,
    catalogDefaultDosage: maps.catalogDefaultDosageByMed.get(medId) ?? null,
  }
}

/**
 * Bulk-loads PRN dose state for a set of people.
 * Covers active person_medications and meds dosed in the last 14 days.
 * All 24h window queries use a fixed 24h rolling window.
 */
export function loadMedicationDoseState(
  db: Database.Database,
  people: { id: number; date_of_birth: string | null }[],
): MedicationDoseStateMaps {
  if (people.length === 0) return emptyMaps()

  const ids = people.map(p => p.id)
  const ph = ids.map(() => "?").join(",")

  const activePersonMeds = db
    .prepare(
      `SELECT person_id, medication_id FROM person_medications
       WHERE is_active = 1 AND person_id IN (${ph})`,
    )
    .all(...ids) as { person_id: number; medication_id: number }[]

  const recentDosedMeds = db
    .prepare(
      `SELECT DISTINCT mr.person_id, mr.medication_id
         FROM medication_records mr
         JOIN medications m ON m.id = mr.medication_id AND m.is_active = 1
        WHERE mr.person_id IN (${ph})
          AND datetime(mr.recorded_at) >= datetime('now', '-14 days')`,
    )
    .all(...ids) as { person_id: number; medication_id: number }[]

  const frequencyMedIdsByPerson = new Map<number, Set<number>>()
  const addPair = (personId: number, medId: number) => {
    let set = frequencyMedIdsByPerson.get(personId)
    if (!set) {
      set = new Set()
      frequencyMedIdsByPerson.set(personId, set)
    }
    set.add(medId)
  }
  for (const r of activePersonMeds) addPair(r.person_id, r.medication_id)
  for (const r of recentDosedMeds) addPair(r.person_id, r.medication_id)

  // Load catalogue metadata for all relevant medications
  const allMedIds = new Set<number>()
  for (const [, meds] of frequencyMedIdsByPerson) for (const mid of meds) allMedIds.add(mid)

  const catalogDefaultDosageByMed = new Map<number, number | null>()
  const medDosageUnitById = new Map<number, string>()

  if (allMedIds.size > 0) {
    const midList = [...allMedIds]
    const midPh = midList.map(() => "?").join(",")
    const medRows = db
      .prepare(
        `SELECT id, dosage_unit, default_dosage FROM medications WHERE id IN (${midPh})`,
      )
      .all(...midList) as { id: number; dosage_unit: string; default_dosage: number | null }[]
    for (const m of medRows) {
      catalogDefaultDosageByMed.set(m.id, m.default_dosage)
      medDosageUnitById.set(m.id, m.dosage_unit)
    }
  }

  // Bulk-load frequency rules for every relevant medication in one query, keyed by medication_id
  // so the per-person/med loop below does a pure in-memory lookup instead of a query each.
  const rulesByMed = new Map<number, FrequencyRule[]>()
  if (allMedIds.size > 0) {
    const midList = [...allMedIds]
    const midPh = midList.map(() => "?").join(",")
    const ruleRows = db
      .prepare(
        `SELECT * FROM medication_frequency_rules WHERE medication_id IN (${midPh})
         ORDER BY medication_id, COALESCE(min_age_years, -1), min_hours_between`,
      )
      .all(...midList) as FrequencyRule[]
    for (const r of ruleRows) {
      if (r.medication_id == null) continue
      const arr = rulesByMed.get(r.medication_id)
      if (arr) arr.push(r)
      else rulesByMed.set(r.medication_id, [r])
    }
  }

  // Bulk-load rolling 24h dose totals/oldest across every (person, medication) pair in one query
  // instead of two queries per pair (form-local — own medication_id only, no sibling groups).
  const dose24hByKey = new Map<string, { count: number; sumByUnit: Map<string, number>; oldest: string | null }>()
  if (ids.length > 0 && allMedIds.size > 0) {
    const midList = [...allMedIds]
    const midPh = midList.map(() => "?").join(",")
    const rows = db
      .prepare(
        `SELECT person_id, medication_id, recorded_at, dosage, dosage_unit
           FROM medication_records
          WHERE person_id IN (${ph}) AND medication_id IN (${midPh})
            AND datetime(recorded_at) >= datetime('now', '-24 hours')`,
      )
      .all(...ids, ...midList) as {
      person_id: number
      medication_id: number
      recorded_at: string
      dosage: number | null
      dosage_unit: string | null
    }[]
    for (const r of rows) {
      const key = `${r.person_id}:${r.medication_id}`
      let agg = dose24hByKey.get(key)
      if (!agg) {
        agg = { count: 0, sumByUnit: new Map(), oldest: null }
        dose24hByKey.set(key, agg)
      }
      agg.count++
      if (agg.oldest === null || r.recorded_at < agg.oldest) agg.oldest = r.recorded_at
      if (r.dosage != null && r.dosage_unit != null) {
        agg.sumByUnit.set(r.dosage_unit, (agg.sumByUnit.get(r.dosage_unit) ?? 0) + r.dosage)
      }
    }
  }

  // Bulk-load recent last-dose/last-dosage candidates (with sibling groups resolved once per
  // unique medication) over a lookback window; pairs with no dose inside the window fall back
  // to the original per-pair query below, which is rare in practice.
  const siblingIdsByMed = getGroupSiblingIdsBulk(db, [...allMedIds])
  const allSiblingIds = new Set<number>()
  for (const sibs of siblingIdsByMed.values()) for (const sid of sibs) allSiblingIds.add(sid)

  const recentDoseRowsByPerson = new Map<number, RecentDoseRow[]>()
  if (ids.length > 0 && allSiblingIds.size > 0) {
    const sibPh = [...allSiblingIds].map(() => "?").join(",")
    const rows = db
      .prepare(
        `SELECT mr.person_id, mr.medication_id, mr.recorded_at, mr.dosage, mr.dosage_unit,
                ppr.remind_after_hours, m.name AS med_name
           FROM medication_records mr
           LEFT JOIN prn_push_requests ppr ON ppr.medication_record_id = mr.id
           LEFT JOIN medications m ON m.id = mr.medication_id
          WHERE mr.person_id IN (${ph}) AND mr.medication_id IN (${sibPh})
            AND datetime(mr.recorded_at) >= datetime('now', '-${LAST_DOSE_LOOKBACK_DAYS} days')
          ORDER BY mr.recorded_at DESC, mr.id DESC`,
      )
      .all(...ids, ...allSiblingIds) as RecentDoseRow[]
    for (const r of rows) {
      const arr = recentDoseRowsByPerson.get(r.person_id)
      if (arr) arr.push(r)
      else recentDoseRowsByPerson.set(r.person_id, [r])
    }
  }

  // Build dose state maps
  const ruleByPersonMed = new Map<string, FrequencyRule | null>()
  const total24hByPersonMed = new Map<string, number>()
  const oldest24hByPersonMed = new Map<string, string | null>()
  const lastDoseByPersonMed = new Map<
    string,
    { lastIso: string; remindAfterHours: number | null; lastMedName: string | null } | null
  >()
  const lastDosageByPersonMed = new Map<string, number | null>()

  const ageTz = resolveAgeTimezone(db)
  for (const person of people) {
    const pid = person.id
    const personAge =
      person.date_of_birth != null && person.date_of_birth !== ""
        ? fractionalAgeYears(person.date_of_birth, ageTz)
        : null
    const weightKg = getLatestPersonWeightKg(db, pid)
    const personRecentRows = recentDoseRowsByPerson.get(pid) ?? []
    for (const mid of frequencyMedIdsByPerson.get(pid) ?? []) {
      const key = `${pid}:${mid}`
      const rule = findRuleFromList(rulesByMed.get(mid) ?? [], personAge, weightKg)
      ruleByPersonMed.set(key, rule)

      const agg = dose24hByKey.get(key)
      const catalogUnit = medDosageUnitById.get(mid) ?? "Tabs"
      total24hByPersonMed.set(
        key,
        rule
          ? ruleMax24hIsDoseCount(rule)
            ? (agg?.count ?? 0)
            : (agg?.sumByUnit.get(catalogUnit) ?? 0)
          : 0,
      )
      oldest24hByPersonMed.set(key, rule?.max_quantity_per_24h != null ? (agg?.oldest ?? null) : null)

      const siblingIds = siblingIdsByMed.get(mid) ?? [mid]
      const siblingSet = new Set(siblingIds)
      const lastDoseRow = personRecentRows.find(r => siblingSet.has(r.medication_id))
      lastDoseByPersonMed.set(
        key,
        lastDoseRow
          ? {
              lastIso: lastDoseRow.recorded_at,
              remindAfterHours: lastDoseRow.remind_after_hours ?? null,
              lastMedName: lastDoseRow.med_name ?? null,
            }
          : getLastGroupDoseWithOffset(db, pid, mid),
      )
      const lastDosageRow = personRecentRows.find(
        r => siblingSet.has(r.medication_id) && r.dosage != null && r.dosage > 0,
      )
      lastDosageByPersonMed.set(
        key,
        lastDosageRow ? lastDosageRow.dosage : getLastRecordedDosageForMed(db, pid, mid),
      )
    }
  }

  return {
    frequencyMedIdsByPerson,
    ruleByPersonMed,
    total24hByPersonMed,
    oldest24hByPersonMed,
    lastDoseByPersonMed,
    lastDosageByPersonMed,
    catalogDefaultDosageByMed,
  }
}

function emptyMaps(): MedicationDoseStateMaps {
  return {
    frequencyMedIdsByPerson: new Map(),
    ruleByPersonMed: new Map(),
    total24hByPersonMed: new Map(),
    oldest24hByPersonMed: new Map(),
    lastDoseByPersonMed: new Map(),
    lastDosageByPersonMed: new Map(),
    catalogDefaultDosageByMed: new Map(),
  }
}
