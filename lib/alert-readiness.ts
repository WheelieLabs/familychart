// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import type { CalendarContext } from "@/lib/calendar-context"
import { resolveCalendarContext } from "@/lib/calendar-context"
import { addCalendarDaysToIsoYmd, formatHHMM, parseHHMM } from "@/lib/datetime"
import type { Person } from "@/lib/domain-types"
import { resolveInstanceTimezone } from "@/lib/instance-timezone"
import { allowsOnlyOneDosePerDay, type MedicationDoseSlice, type PrnEvalResult } from "@/lib/prn/prn-eval"
import {
  doseSliceFromMaps,
  evaluatePrnState,
  loadMedicationDoseState,
} from "@/lib/medication/medication-dose-state"
import type { PersonObservationExpectationRow } from "@/lib/observation/observation-recurrence"
import { isObservationAlertEligible, loadLastObservationAtByPersonType } from "@/lib/observation/observation-schedule"
import { listObservationTypeConfigs } from "@/lib/observation/observation-type-meta"
import { PRN_REMIND_DEFAULT_MAX_HOURS } from "@/lib/prn/prn-remind-hours"
import { loadSlotEvaluatorConfig } from "@/lib/schedule/schedule-config"
import { derivePendingExpectations, isSlotExternal } from "@/lib/schedule/dose-expectation"
import { loadDoseExpectationState } from "@/lib/schedule/dose-expectation-store"
import { loadSlotOutcomes } from "@/lib/schedule/slot-outcomes"
import {
  dosageForScheduledTime,
  isScheduleActiveOnYmd,
  isScheduleInEffectOnYmd,
  parseScheduleFrequencyUnknown,
  parseScheduleTimesJson,
} from "@/lib/schedule/schedule-recurrence"
import {
  collectDueScheduledSlots,
  resolveSlotMs,
  type DueScheduledSlot,
  isSlotBeforeScheduleCreation,
  type ScheduleAssemblyRow,
} from "@/lib/schedule/schedule-slot-evaluator"

export type ScheduledSlotFact = {
  personId: number
  personName: string
  personMedicationId: number
  medicationId: number
  medicationName: string
  ymd: string
  hhmm: string
  scheduledTime: string
  scheduledDosage: number
  status: DueScheduledSlot["status"]
}

export type PrnFrequencyFact = {
  personId: number
  personName: string
  medicationId: number
  medicationName: string
  atCap: boolean
  cooldown: boolean
  coverageGap: boolean
  remindAfterDue: boolean
  /** Alert-clear only — never permission to write a medication record (ADR-0011). */
  canDose: boolean
  resetAtMs: number | null
  availableAtMs: number | null
  remindAfterRecordIds: number[]
}

export type OverdueObservationFact = {
  personId: number
  personName: string
  expectationId: number
  observationType: string
  localYmd: string | null
}

/** A dose expected away from home (e.g. at school) that is awaiting the parent's confirmation. */
export type PendingDoseExpectationFact = {
  personId: number
  personName: string
  personMedicationId: number
  medicationId: number
  medicationName: string
  expectationId: number
  ymd: string
  hhmm: string
  slotMs: number
  scheduledDosage: number
}

export type AlertReadiness = {
  scheduledSlots: ScheduledSlotFact[]
  prnBlockedSlots: ScheduledSlotFact[]
  prnFlags: PrnFrequencyFact[]
  overdueObservations: OverdueObservationFact[]
  pendingDoseExpectations: PendingDoseExpectationFact[]
}

const EMPTY_READINESS: AlertReadiness = {
  scheduledSlots: [],
  prnBlockedSlots: [],
  prnFlags: [],
  overdueObservations: [],
  pendingDoseExpectations: [],
}

type ScheduledMedRow = {
  person_medication_id: number
  person_id: number
  medication_id: number
  medication_name: string
  schedule_times: string | null
  schedule_slots: string | null
  schedule_frequency: string | null
  schedule_start_date: string | null
  schedule_end_date: string | null
  schedule_created_at_ms: number | null
  schedule_tz: string | null
}

/**
 * Whether an assignment counts as "scheduled": it has schedule times and a schedule in effect on
 * the day (started, not ended). Deliberately not `isScheduleActiveOnYmd`: a weekly or every-N-days
 * schedule on an off day is still a scheduled medication, otherwise its expected cap would flip
 * back into an alert every off day. A medication with several assignments counts if any one does.
 */
export function isAssignmentScheduledOnYmd(
  row: Pick<ScheduleAssemblyRow, "scheduleTimesRaw" | "scheduleFrequencyRaw" | "scheduleStartDate" | "scheduleEndDate">,
  ymd: string,
): boolean {
  if (parseScheduleTimesJson(row.scheduleTimesRaw).length === 0) return false
  const freq = parseScheduleFrequencyUnknown(row.scheduleFrequencyRaw)
  return isScheduleInEffectOnYmd(freq, row.scheduleStartDate, row.scheduleEndDate, ymd)
}

/**
 * The single decision point for a medication's 24h-maximum state. Scheduled and allowing only one
 * dose a day, the cap is the expected state after the dose, so `atCap` is cleared (cooldown, the
 * coverage gap and timing are untouched). The dashboard issues, reminder blocking and the
 * per-person medication timeline all read this result, so they cannot disagree.
 */
export function evaluateMedicationPrnState(slice: MedicationDoseSlice, now: Date, scheduled: boolean): PrnEvalResult {
  const raw = evaluatePrnState(slice, now)
  const capExpected = raw.atCap && scheduled && allowsOnlyOneDosePerDay(slice)
  return capExpected ? { ...raw, atCap: false, canDose: !raw.cooldown } : raw
}

/**
 * Caregiver alert facts for dashboard and cron. Callers pass the already-filtered People set;
 * this module does not implement ACL. Hydration is out of scope (existing evaluator).
 */
export function evaluateAlertReadiness(
  db: Database.Database,
  people: Person[],
  nowMs: number,
  fallbackCalCtx?: CalendarContext | null,
): AlertReadiness {
  if (people.length === 0) return EMPTY_READINESS

  const now = new Date(nowMs)
  const personById = new Map(people.map(p => [p.id, p]))
  const ids = people.map(p => p.id)
  const placeholders = ids.map(() => "?").join(",")

  const scheduledMeds = db
    .prepare(
      `SELECT pm.id AS person_medication_id, pm.person_id, pm.medication_id, m.name AS medication_name,
              pm.schedule_times, pm.schedule_slots, pm.schedule_frequency, pm.schedule_start_date, pm.schedule_end_date,
              pm.schedule_created_at_ms, pm.schedule_tz
       FROM person_medications pm
       JOIN medications m ON m.id = pm.medication_id
       WHERE pm.is_active = 1 AND m.is_active = 1 AND pm.person_id IN (${placeholders})
       ORDER BY m.name COLLATE NOCASE`,
    )
    .all(...ids) as ScheduledMedRow[]

  const assemblyRows: ScheduleAssemblyRow[] = []
  for (const row of scheduledMeds) {
    const ctx = resolveCalendarContext(db, row.schedule_tz, nowMs) ?? fallbackCalCtx ?? null
    if (!ctx) continue
    assemblyRows.push({
      personMedicationId: row.person_medication_id,
      personId: row.person_id,
      medicationId: row.medication_id,
      scheduleTimesRaw: row.schedule_times,
      scheduleSlotsRaw: row.schedule_slots,
      scheduleFrequencyRaw: row.schedule_frequency,
      scheduleStartDate: row.schedule_start_date,
      scheduleEndDate: row.schedule_end_date,
      scheduleCreatedAtMs: row.schedule_created_at_ms,
      medDefaultDosage: null,
      calCtx: ctx,
    })
  }

  const rowDays = new Set<string>()
  for (const row of assemblyRows) {
    rowDays.add(addCalendarDaysToIsoYmd(row.calCtx.ymd, -1))
    rowDays.add(row.calCtx.ymd)
    rowDays.add(addCalendarDaysToIsoYmd(row.calCtx.ymd, 1))
  }
  const pmIds = scheduledMeds.map(r => r.person_medication_id)

  const recordedDoseMsByPersonMed = new Map<string, number[]>()
  const schedMedIds = [...new Set(scheduledMeds.map(r => r.medication_id))]
  if (schedMedIds.length > 0) {
    const medPlaceholders = schedMedIds.map(() => "?").join(",")
    const doseRows = db
      .prepare(
        `SELECT person_id, medication_id, recorded_at
           FROM medication_records
          WHERE person_id IN (${placeholders})
            AND medication_id IN (${medPlaceholders})
            AND datetime(recorded_at) >= datetime(?, 'unixepoch', '-3 days')`,
      )
      .all(...ids, ...schedMedIds, Math.floor(nowMs / 1000)) as {
      person_id: number
      medication_id: number
      recorded_at: string
    }[]
    for (const r of doseRows) {
      const ms = new Date(r.recorded_at).getTime()
      if (!Number.isFinite(ms)) continue
      const key = `${r.person_id}:${r.medication_id}`
      const arr = recordedDoseMsByPersonMed.get(key)
      if (arr) arr.push(ms)
      else recordedDoseMsByPersonMed.set(key, [ms])
    }
  }

  const doseState = loadMedicationDoseState(db, people)
  for (const row of assemblyRows) {
    row.medDefaultDosage = doseState.catalogDefaultDosageByMed.get(row.medicationId) ?? null
  }

  const medNameById = new Map<number, string>()
  for (const r of scheduledMeds) medNameById.set(r.medication_id, r.medication_name)
  const medNamesAll = db
    .prepare(`SELECT id, name FROM medications WHERE is_active = 1`)
    .all() as { id: number; name: string }[]
  for (const m of medNamesAll) {
    if (!medNameById.has(m.id)) medNameById.set(m.id, m.name)
  }

  const medNameByPmId = new Map(scheduledMeds.map(r => [r.person_medication_id, r.medication_name]))

  const cfg = loadSlotEvaluatorConfig(db)

  // Dose expectations: a slot routinely given away from home is not a home-alert slot — its
  // normal upcoming/overdue alert (and push) is replaced by a pending-confirmation prompt.
  const expectationYmds = [...rowDays]
  const expectationState = loadDoseExpectationState(db, pmIds, expectationYmds)
  const externalSlot = (pmId: number, ymd: string, hhmm: string): boolean =>
    isSlotExternal(expectationState.expectations, expectationState.exceptionsByExpectation, pmId, hhmm, ymd)

  const dueSlots: DueScheduledSlot[] = []
  for (const row of assemblyRows) {
    const days = [
      addCalendarDaysToIsoYmd(row.calCtx.ymd, -1),
      row.calCtx.ymd,
      addCalendarDaysToIsoYmd(row.calCtx.ymd, 1),
    ]
    dueSlots.push(
      ...collectDueScheduledSlots(
        [row],
        days,
        nowMs,
        cfg,
        externalSlot,
        (personId, medId) => recordedDoseMsByPersonMed.get(`${personId}:${medId}`) ?? [],
      ),
    )
  }

  const scheduledMedKeys = new Set<string>()
  for (const row of assemblyRows) {
    if (isAssignmentScheduledOnYmd(row, row.calCtx.ymd)) scheduledMedKeys.add(`${row.personId}:${row.medicationId}`)
  }

  const blockedMedKeys = new Set<string>()
  const prnFlags: PrnFrequencyFact[] = []

  const pendingRemindRows =
    ids.length > 0
      ? (db
          .prepare(
            `SELECT mr.id, mr.person_id, mr.medication_id
               FROM prn_push_requests ppr
               JOIN medication_records mr ON mr.id = ppr.medication_record_id
              WHERE mr.person_id IN (${placeholders})
                AND datetime(mr.recorded_at) >= datetime('now', ?)`,
          )
          .all(...ids, `-${PRN_REMIND_DEFAULT_MAX_HOURS} hours`) as {
          id: number
          person_id: number
          medication_id: number
        }[])
      : []

  const remindIdsByPersonMed = new Map<string, number[]>()
  for (const r of pendingRemindRows) {
    const key = `${r.person_id}:${r.medication_id}`
    const arr = remindIdsByPersonMed.get(key)
    if (arr) arr.push(r.id)
    else remindIdsByPersonMed.set(key, [r.id])
  }

  for (const [pid, medIds] of doseState.frequencyMedIdsByPerson) {
    const who = personById.get(pid)
    if (!who) continue
    for (const mid of medIds) {
      const key = `${pid}:${mid}`
      if (!(doseState.ruleByPersonMed.get(key) ?? null)) continue
      const slice = doseSliceFromMaps(doseState, pid, mid)
      const ev = evaluateMedicationPrnState(slice, now, scheduledMedKeys.has(key))
      if (ev.atCap || ev.cooldown) blockedMedKeys.add(key)

      const pendingIds = slice.rule?.min_hours_between ? (remindIdsByPersonMed.get(key) ?? []) : []
      const remindAfterDue = pendingIds.length > 0 && !ev.atCap && !ev.cooldown
      if (!ev.atCap && !ev.cooldown && !ev.coverageGap && !remindAfterDue) continue

      prnFlags.push({
        personId: pid,
        personName: who.name,
        medicationId: mid,
        medicationName: medNameById.get(mid) ?? "Medication",
        atCap: ev.atCap,
        cooldown: ev.cooldown,
        coverageGap: ev.coverageGap,
        remindAfterDue,
        canDose: ev.canDose,
        resetAtMs: ev.resetAtMs,
        availableAtMs: ev.availableAtMs,
        remindAfterRecordIds: remindAfterDue ? pendingIds : [],
      })
    }
  }

  const scheduledSlots: ScheduledSlotFact[] = []
  const prnBlockedSlots: ScheduledSlotFact[] = []
  for (const slot of dueSlots) {
    const who = personById.get(slot.personId)
    const fact: ScheduledSlotFact = {
      personId: slot.personId,
      personName: who?.name ?? "",
      personMedicationId: slot.personMedicationId,
      medicationId: slot.medicationId,
      medicationName: medNameByPmId.get(slot.personMedicationId) ?? "Medication",
      ymd: slot.ymd,
      hhmm: slot.hhmm,
      scheduledTime: slot.scheduledTime,
      scheduledDosage: slot.scheduledDosage,
      status: slot.status,
    }
    if (blockedMedKeys.has(`${slot.personId}:${slot.medicationId}`)) {
      prnBlockedSlots.push(fact)
    } else {
      scheduledSlots.push(fact)
    }
  }

  const obsExpectRows = db
    .prepare(
      `SELECT * FROM person_observation_expectations
       WHERE person_id IN (${placeholders}) AND enabled = 1`,
    )
    .all(...ids) as PersonObservationExpectationRow[]

  const obsLastByKey =
    obsExpectRows.length > 0 ? loadLastObservationAtByPersonType(db, ids) : new Map<string, string>()

  const obsTypeConfigByType = new Map(
    listObservationTypeConfigs(db).map(c => [c.observation_type.toLowerCase(), c]),
  )
  const instanceIanaTz = resolveInstanceTimezone(db)

  const overdueObservations: OverdueObservationFact[] = []
  for (const exp of obsExpectRows) {
    const who = personById.get(exp.person_id)
    if (!who) continue
    const lastIso = obsLastByKey.get(`${exp.person_id}:${exp.observation_type}`) ?? null
    const cfgExpected = obsTypeConfigByType.get(exp.observation_type.toLowerCase())
    if (
      !isObservationAlertEligible(
        exp,
        lastIso,
        who.date_of_birth,
        now,
        instanceIanaTz,
        cfgExpected,
      )
    ) {
      continue
    }
    const obsCtx = resolveCalendarContext(db, exp.tz, nowMs) ?? fallbackCalCtx ?? null
    overdueObservations.push({
      personId: exp.person_id,
      personName: who.name,
      expectationId: exp.id,
      observationType: exp.observation_type,
      localYmd: obsCtx?.ymd ?? null,
    })
  }

  const rowByPmId = new Map(scheduledMeds.map(r => [r.person_medication_id, r]))
  const ctxByPmId = new Map(assemblyRows.map(r => [r.personMedicationId, r]))
  // A dose attached to the slot (on time, late or early) answers the pending question.
  const attachedSlots = new Set(
    loadSlotOutcomes(db, pmIds, expectationYmds)
      .filter(o => o.recordId != null)
      .map(o => `${o.personMedicationId}|${o.ymd}|${o.slotHhmm}`),
  )
  const pendingDoseExpectations: PendingDoseExpectationFact[] = derivePendingExpectations({
    expectations: expectationState.expectations,
    exceptionsByExpectation: expectationState.exceptionsByExpectation,
    outcomes: expectationState.outcomes,
    doseMsFor: e => {
      const row = rowByPmId.get(e.personMedicationId)
      return row ? (recordedDoseMsByPersonMed.get(`${row.person_id}:${row.medication_id}`) ?? []) : []
    },
    resolve: e => {
      const assembly = ctxByPmId.get(e.personMedicationId)
      if (!assembly) return null
      // The expectation only means something while the slot still exists and the medication's own
      // schedule runs today (frequency, start and end dates, and an edited-out slot time).
      const hasSlot = parseScheduleTimesJson(assembly.scheduleTimesRaw).some(t => {
        const hm = parseHHMM(t)
        return hm != null && formatHHMM(hm.h, hm.m) === e.slotHhmm
      })
      const freq = parseScheduleFrequencyUnknown(assembly.scheduleFrequencyRaw)
      if (!hasSlot || !isScheduleActiveOnYmd(freq, assembly.scheduleStartDate, assembly.scheduleEndDate, assembly.calCtx.ymd)) {
        return null
      }
      const slotMs = resolveSlotMs(assembly.calCtx, assembly.calCtx.ymd, e.slotHhmm)
      if (!Number.isFinite(slotMs)) return null
      const creation = { startDate: assembly.scheduleStartDate, createdAtMs: assembly.scheduleCreatedAtMs ?? null }
      if (isSlotBeforeScheduleCreation(creation, assembly.calCtx, assembly.calCtx.ymd, slotMs)) return null
      return { ymd: assembly.calCtx.ymd, slotMs }
    },
    nowMs,
    cfg,
  }).flatMap(p => {
    if (attachedSlots.has(`${p.personMedicationId}|${p.ymd}|${p.hhmm}`)) return []
    const row = rowByPmId.get(p.personMedicationId)
    const assembly = ctxByPmId.get(p.personMedicationId)
    if (!row || !assembly) return []
    return [{
      personId: row.person_id,
      personName: personById.get(row.person_id)?.name ?? "",
      personMedicationId: p.personMedicationId,
      medicationId: row.medication_id,
      medicationName: row.medication_name,
      expectationId: p.expectationId,
      ymd: p.ymd,
      hhmm: p.hhmm,
      slotMs: p.slotMs,
      scheduledDosage: dosageForScheduledTime(p.hhmm, row.schedule_slots, assembly.medDefaultDosage),
    }]
  })

  return { scheduledSlots, prnBlockedSlots, prnFlags, overdueObservations, pendingDoseExpectations }
}
