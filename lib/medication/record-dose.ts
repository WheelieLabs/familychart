// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { validateMedicationRecordWrite } from "@/lib/medication/medication-record-validation"
import { ensureActivePersonMedicationLink } from "@/lib/person/person-medication-assign"
import { clearSupersededPrnPushRequests } from "@/lib/prn/prn-push-supersede"
import { classifyAndAttachDose, settleSlots, type CalendarFor, type DoseTiming } from "@/lib/schedule/slot-outcomes"

export interface RecordDoseInput {
  personId: number
  medicationId: number
  recordedAt: unknown
  dosage?: unknown
  dosageUnit?: unknown
  comments?: string | null
  administeredBy?: unknown
  createdBy: string | null
  /** Clock for settling slots; defaults to `Date.now()`. */
  nowMs?: number
  /** Calendar context per schedule timezone (a request can supply the client's offset); defaults to IANA only. */
  calendarFor?: CalendarFor
  /** The caller attaches the dose to its slot itself (dose expectation "Given"). */
  skipTiming?: boolean
}

export type RecordDoseResult =
  | {
      ok: true
      recordId: number
      clearedPrnPushRequests: number
      dosageUnitMismatch: boolean
      /** How the dose sits against its schedule; `needs_prompt` is data for the caller, nothing is stored yet. */
      timing: DoseTiming
      /** True when the dose attached to a slot, so that slot's reminder should be cleared. */
      clearsReminder: boolean
      /** Slots that became Missed as a result (next slot started or day ended). */
      missedSlots: { personMedicationId: number; ymd: string; slotHhmm: string }[]
    }
  | { ok: false; error: string }

/**
 * The single write path for a medication dose: validate, ensure the person-medication link, insert,
 * and supersede any PRN push request the dose answers. Deliberately never gates on cooldown or 24h
 * caps — FamilyChart is a record-keeping tool and frequency rules only drive alerts and reminders.
 * Audit logging and acknowledgement pushes stay with the caller, which owns the request context.
 *
 * `requirePersonLink:false` — recording a dose assigns the medication to the person, so a
 * pre-existing link isn't required; the medication's existence/active state and age bounds are
 * still enforced before any link is created.
 */
export function recordDose(db: Database.Database, input: RecordDoseInput): RecordDoseResult {
  const validated = validateMedicationRecordWrite(
    db,
    {
      medication_id: input.medicationId,
      recorded_at: input.recordedAt,
      dosage: input.dosage,
      dosage_unit: input.dosageUnit,
      administered_by: input.administeredBy,
      person_id: input.personId,
    },
    { requirePersonLink: false },
  )
  if (!validated.ok) return { ok: false, error: validated.error }

  ensureActivePersonMedicationLink(db, input.personId, input.medicationId, input.createdBy ?? undefined)

  const insertAndSupersede = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO medication_records (person_id, medication_id, recorded_at, dosage, dosage_unit, comments, administered_by, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.personId,
        input.medicationId,
        validated.recordedAt,
        validated.dosage,
        validated.dosageUnit,
        input.comments ?? null,
        validated.administeredBy,
        input.createdBy,
      )
    const recordId = Number(result.lastInsertRowid)
    const clearedPrnPushRequests = clearSupersededPrnPushRequests(db, {
      personId: input.personId,
      medicationId: input.medicationId,
      currentRecordId: recordId,
      recordedAt: validated.recordedAt,
    })
    const timing: DoseTiming = input.skipTiming
      ? { kind: "unscheduled" }
      : classifyAndAttachDose(db, {
          personId: input.personId,
          medicationId: input.medicationId,
          recordId,
          recordedMs: Date.parse(validated.recordedAt),
          calendarFor: input.calendarFor,
        })
    const missedSlots = settleSlots(db, { nowMs: input.nowMs ?? Date.now(), calendarFor: input.calendarFor, personId: input.personId }).missed
    return { recordId, clearedPrnPushRequests, timing, missedSlots }
  })
  const { recordId, clearedPrnPushRequests, timing, missedSlots } = insertAndSupersede()
  return {
    ok: true,
    recordId,
    clearedPrnPushRequests,
    dosageUnitMismatch: validated.dosageUnitMismatch,
    timing,
    clearsReminder: timing.kind === "on_time",
    missedSlots,
  }
}
