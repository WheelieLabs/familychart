// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reads of the slot outcomes store for display (History, the medication timeline, the dashboard).
 * `loadSlotOutcomes` answers "these Person medications on these Calendar days"; these answer the
 * other questions the displays ask. Nothing here writes.
 */

import type Database from "better-sqlite3-multiple-ciphers"
import { doseTimingFromOutcome, type DoseTiming } from "@/lib/medication/dose-timing-display"
import type { MissedCause, SlotResult } from "@/lib/schedule/slot-outcomes"
import { runInChunks } from "@/lib/sql-chunks"

type TimingRow = {
  medication_record_id: number
  result: SlotResult
  offset_minutes: number | null
  slot_hhmm: string
}

/** The timing of each given dose, keyed by medication record id. Doses with no attached slot are absent. */
export function loadDoseTimingByRecord(db: Database.Database, recordIds: readonly number[]): Map<number, DoseTiming> {
  const out = new Map<number, DoseTiming>()
  if (recordIds.length === 0) return out
  const rows = runInChunks(recordIds, chunk =>
    db
      .prepare(
        `SELECT medication_record_id, result, offset_minutes, slot_hhmm
           FROM slot_outcomes
          WHERE medication_record_id IN (${chunk.map(() => "?").join(",")})`,
      )
      .all(...chunk) as TimingRow[],
  )
  for (const r of rows) {
    const timing = doseTimingFromOutcome({
      result: r.result,
      offsetMinutes: r.offset_minutes,
      slotHhmm: r.slot_hhmm,
      recordId: r.medication_record_id,
    })
    if (timing) out.set(r.medication_record_id, timing)
  }
  return out
}

export interface MissedSlot {
  id: number
  personMedicationId: number
  personId: number
  medicationName: string
  ymd: string
  slotHhmm: string
  cause: MissedCause | null
  /** When the slot became Missed (the row was written), epoch ms; null when unknown. */
  settledAtMs: number | null
  scheduleTz: string | null
}

type MissedRow = {
  id: number
  person_medication_id: number
  person_id: number
  medication_name: string
  local_ymd: string
  slot_hhmm: string
  missed_cause: MissedCause | null
  created_at: string | null
  schedule_tz: string | null
}

/**
 * Missed slots for one Person with a Calendar day inside [fromYmd, toYmd] (either bound may be null),
 * newest first. Missed rows are kept for History even if the assignment is later made inactive.
 */
export function loadMissedSlots(
  db: Database.Database,
  personId: number,
  range: { fromYmd: string | null; toYmd: string | null },
  /** Only this medication (`medications.id`), or every medication when omitted. */
  medicationId?: number,
): MissedSlot[] {
  const conditions = ["pm.person_id = ?", "so.result = 'missed'"]
  const values: (string | number)[] = [personId]
  if (medicationId !== undefined) {
    conditions.push("pm.medication_id = ?")
    values.push(medicationId)
  }
  if (range.fromYmd) {
    conditions.push("so.local_ymd >= ?")
    values.push(range.fromYmd)
  }
  if (range.toYmd) {
    conditions.push("so.local_ymd <= ?")
    values.push(range.toYmd)
  }
  const rows = db
    .prepare(
      `SELECT so.id, so.person_medication_id, pm.person_id, m.name AS medication_name, so.local_ymd, so.slot_hhmm,
              so.missed_cause, so.created_at, pm.schedule_tz
         FROM slot_outcomes so
         JOIN person_medications pm ON pm.id = so.person_medication_id
         JOIN medications m ON m.id = pm.medication_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY so.local_ymd DESC, so.slot_hhmm DESC, so.id DESC`,
    )
    .all(...values) as MissedRow[]
  return rows.map(r => ({
    id: r.id,
    personMedicationId: r.person_medication_id,
    personId: r.person_id,
    medicationName: r.medication_name,
    ymd: r.local_ymd,
    slotHhmm: r.slot_hhmm,
    cause: r.missed_cause,
    // SQLite CURRENT_TIMESTAMP is UTC without a zone marker.
    settledAtMs: r.created_at ? Date.parse(`${r.created_at.replace(" ", "T")}Z`) : null,
    scheduleTz: r.schedule_tz,
  }))
}
