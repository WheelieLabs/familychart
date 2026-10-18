// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { auditLog } from "../audit-log"
import { localYmdRangeToUtcIsoBounds, utcMsToLocalYmd } from "../datetime"

export * from "./symptom-dose-link-types"
import type { LinkDose, LinkSymptom, PersonLink } from "./symptom-dose-link-types"

interface SpanInput {
  start_date: string
  end_date: string | null
  is_resolved: boolean
  resolved_at: string | null
}

/**
 * Local days a symptom covers, inclusive (server-side mirror of the Calendar's `symptomSpan`):
 * the end date wins; else a resolved symptom ends on its resolved day; an open one runs through today.
 */
export function symptomSpanYmd(s: SpanInput, todayYmd: string, tzOffsetMinutes: number): { start: string; end: string } {
  const ymd = (iso: string) => utcMsToLocalYmd(new Date(iso).getTime(), tzOffsetMinutes)
  const start = ymd(s.start_date)
  const end = s.end_date ? ymd(s.end_date) : s.is_resolved && s.resolved_at ? ymd(s.resolved_at) : todayYmd
  return { start, end: end < start ? start : end }
}

const DOSE_SELECT = `SELECT r.id, r.recorded_at, m.name AS medication_name, r.dosage, r.dosage_unit
                       FROM medication_records r JOIN medications m ON m.id = r.medication_id`

/** The Person's symptoms whose span covers the dose's local day, most recent first. */
export function candidateSymptomsForDose(
  db: Database.Database,
  personId: number,
  recordedAtIso: string,
  todayYmd: string,
  tzOffsetMinutes: number,
): LinkSymptom[] {
  const doseDay = utcMsToLocalYmd(new Date(recordedAtIso).getTime(), tzOffsetMinutes)
  const rows = db.prepare(
    `SELECT id, label, start_date, end_date, is_resolved, resolved_at
       FROM symptom_events WHERE person_id = ? ORDER BY start_date DESC, id DESC`
  ).all(personId) as (Omit<LinkSymptom, "is_resolved"> & { is_resolved: number; resolved_at: string | null })[]
  return rows
    .filter(r => {
      const span = symptomSpanYmd({ ...r, is_resolved: r.is_resolved === 1 }, todayYmd, tzOffsetMinutes)
      return span.start <= doseDay && doseDay <= span.end
    })
    .map(r => ({ id: r.id, label: r.label, start_date: r.start_date, end_date: r.end_date, is_resolved: r.is_resolved === 1 }))
}

/** The Person's doses on any local day within a symptom's span, most recent first, optionally capped. */
export function candidateDosesForSpan(
  db: Database.Database,
  personId: number,
  symptom: SpanInput,
  todayYmd: string,
  tzOffsetMinutes: number,
  limit?: number,
): LinkDose[] {
  const span = symptomSpanYmd(symptom, todayYmd, tzOffsetMinutes)
  const bounds = localYmdRangeToUtcIsoBounds(span.start, span.end, tzOffsetMinutes)
  if (!bounds) return []
  return db.prepare(
    `${DOSE_SELECT}
      WHERE r.person_id = ? AND r.recorded_at >= ? AND r.recorded_at <= ?
      ORDER BY r.recorded_at DESC, r.id DESC${limit ? " LIMIT ?" : ""}`
  ).all(personId, bounds.fromUtc, bounds.toUtc, ...(limit ? [limit] : [])) as LinkDose[]
}

/**
 * Every id must exist and belong to the Person: a link never crosses Persons. Returns the first
 * problem as a message, or null.
 */
export function validateLinkTargets(
  db: Database.Database,
  personId: number,
  symptomIds: readonly number[],
  recordIds: readonly number[],
): string | null {
  const owns = (table: string, ids: readonly number[]) => {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return true
    const found = db.prepare(
      `SELECT COUNT(*) AS n FROM ${table} WHERE person_id = ? AND id IN (${unique.map(() => "?").join(",")})`
    ).get(personId, ...unique) as { n: number }
    return found.n === unique.length
  }
  if (!owns("symptom_events", symptomIds)) return "Symptom not found for this person"
  if (!owns("medication_records", recordIds)) return "Dose not found for this person"
  return null
}

/** Links every symptom to every dose given (already validated); existing links are left alone. Returns the new pairs. */
export function addLinks(
  db: Database.Database,
  input: { personId: number; symptomIds: readonly number[]; recordIds: readonly number[]; createdBy: string | null },
): { symptomId: number; recordId: number }[] {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO symptom_dose_links (symptom_event_id, medication_record_id, person_id, created_by)
     VALUES (?, ?, ?, ?)`
  )
  const created: { symptomId: number; recordId: number }[] = []
  for (const symptomId of new Set(input.symptomIds)) {
    for (const recordId of new Set(input.recordIds)) {
      if (insert.run(symptomId, recordId, input.personId, input.createdBy).changes > 0) created.push({ symptomId, recordId })
    }
  }
  return created
}

/** Unlinks every symptom/dose pair given; pairs that were not linked are ignored. Returns the removed pairs. */
export function removeLinks(
  db: Database.Database,
  input: { personId: number; symptomIds: readonly number[]; recordIds: readonly number[] },
): { symptomId: number; recordId: number }[] {
  const del = db.prepare(
    "DELETE FROM symptom_dose_links WHERE symptom_event_id = ? AND medication_record_id = ? AND person_id = ?"
  )
  const removed: { symptomId: number; recordId: number }[] = []
  for (const symptomId of new Set(input.symptomIds)) {
    for (const recordId of new Set(input.recordIds)) {
      if (del.run(symptomId, recordId, input.personId).changes > 0) removed.push({ symptomId, recordId })
    }
  }
  return removed
}

export function linkedDosesForSymptom(db: Database.Database, symptomId: number): LinkDose[] {
  return db.prepare(
    `${DOSE_SELECT} JOIN symptom_dose_links l ON l.medication_record_id = r.id
      WHERE l.symptom_event_id = ? ORDER BY r.recorded_at DESC, r.id DESC`
  ).all(symptomId) as LinkDose[]
}

export function linkedSymptomsForDose(db: Database.Database, recordId: number): LinkSymptom[] {
  const rows = db.prepare(
    `SELECT s.id, s.label, s.start_date, s.end_date, s.is_resolved
       FROM symptom_events s JOIN symptom_dose_links l ON l.symptom_event_id = s.id
      WHERE l.medication_record_id = ? ORDER BY s.start_date DESC, s.id DESC`
  ).all(recordId) as (Omit<LinkSymptom, "is_resolved"> & { is_resolved: number })[]
  return rows.map(r => ({ ...r, is_resolved: r.is_resolved === 1 }))
}

/** All of a Person's links, both sides described; History builds its chips from one fetch of this. */
export function listPersonLinks(db: Database.Database, personId: number): PersonLink[] {
  return db.prepare(
    `SELECT l.symptom_event_id, s.label AS symptom_label, l.medication_record_id, m.name AS medication_name, r.recorded_at
       FROM symptom_dose_links l
       JOIN symptom_events s ON s.id = l.symptom_event_id
       JOIN medication_records r ON r.id = l.medication_record_id
       JOIN medications m ON m.id = r.medication_id
      WHERE l.person_id = ?
      ORDER BY r.recorded_at DESC, r.id DESC`
  ).all(personId) as PersonLink[]
}

/**
 * Applies removals then additions in one transaction and audit-logs each change on both records
 * (LINK / UNLINK against the symptom and against the dose). Targets must already be validated.
 */
export function changeLinks(
  db: Database.Database,
  input: {
    personId: number
    actorEmail: string | null
    add?: { symptomIds: readonly number[]; recordIds: readonly number[] }
    remove?: { symptomIds: readonly number[]; recordIds: readonly number[] }
  },
): { added: number; removed: number } {
  const run = db.transaction(() => {
    const removed = input.remove ? removeLinks(db, { personId: input.personId, ...input.remove }) : []
    const added = input.add
      ? addLinks(db, { personId: input.personId, createdBy: input.actorEmail, ...input.add })
      : []
    for (const [action, pairs] of [["LINK", added], ["UNLINK", removed]] as const) {
      for (const { symptomId, recordId } of pairs) {
        const details = { person_id: input.personId, symptom_event_id: symptomId, medication_record_id: recordId }
        auditLog(db, input.actorEmail, action, "symptom_events", symptomId, details)
        auditLog(db, input.actorEmail, action, "medication_records", recordId, details)
      }
    }
    return { added: added.length, removed: removed.length }
  })
  return run()
}

/** A request-body id list: undefined is empty; anything but a short array of integers is invalid (null). */
export function parseIdList(raw: unknown): number[] | null {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw) || raw.length > 500 || !raw.every(n => Number.isInteger(n))) return null
  return raw as number[]
}
