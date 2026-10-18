// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { localCalendarYmdHmToUtcMs, utcMsToLocalYmd } from "@/lib/datetime"
import { nextResolvedAt } from "@/lib/symptoms/symptom-resolved-at"

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

/** The household's local day: its date and the client `getTimezoneOffset()` that goes with it. */
export interface LocalDay {
  ymd: string
  offsetMinutes: number
}

/** An Open symptom (unresolved, no end date) that is due its daily "still ongoing or resolved?" question. */
export interface OpenSymptomPrompt {
  symptomId: number
  personId: number
  label: string
  /** Local day the symptom started. */
  startYmd: string
}

interface OpenSymptomRow {
  id: number
  person_id: number
  label: string
  start_date: string
  ongoing_confirmed_on: string | null
}

/**
 * Open symptoms to ask about today: never on the day they started, and not again today once
 * confirmed as still ongoing (they return the next local day). Symptoms with an end date, or
 * already resolved, never prompt.
 */
export function listOpenSymptomPrompts(
  db: Database.Database,
  personIds: number[],
  today: LocalDay,
): OpenSymptomPrompt[] {
  if (personIds.length === 0) return []
  const rows = db
    .prepare(
      `SELECT id, person_id, label, start_date, ongoing_confirmed_on
         FROM symptom_events
        WHERE person_id IN (${personIds.map(() => "?").join(",")})
          AND is_resolved = 0 AND end_date IS NULL
        ORDER BY start_date ASC, id ASC`,
    )
    .all(...personIds) as OpenSymptomRow[]
  const prompts: OpenSymptomPrompt[] = []
  for (const r of rows) {
    const startYmd = utcMsToLocalYmd(Date.parse(r.start_date), today.offsetMinutes)
    if (startYmd >= today.ymd) continue
    if (r.ongoing_confirmed_on === today.ymd) continue
    prompts.push({ symptomId: r.id, personId: r.person_id, label: r.label, startYmd })
  }
  return prompts
}

export type OpenSymptomAnswer =
  | { outcome: "ongoing" }
  /** `resolvedYmd` omitted means today; an earlier day is the "Resolved earlier" choice. */
  | { outcome: "resolved"; resolvedYmd?: string }

export type AnswerOpenSymptomResult =
  | { ok: true; outcome: "ongoing" | "resolved"; personId: number }
  | { ok: false; status: 400 | 404 | 409; error: string }

/** Owner of a symptom, for the access check before an answer is applied. */
export function getSymptomOwner(db: Database.Database, symptomId: number): { personId: number } | null {
  const row = db.prepare("SELECT person_id FROM symptom_events WHERE id = ?").get(symptomId) as { person_id: number } | undefined
  return row ? { personId: row.person_id } : null
}

/**
 * Applies the daily answer. "Still ongoing" records today's confirmation. "Resolved" resolves the
 * symptom (resolved_at stays server-derived) and writes end_date as the start of the chosen local
 * day: today, or an earlier day that is not before the symptom started.
 */
export function answerOpenSymptom(
  db: Database.Database,
  input: { symptomId: number; answer: OpenSymptomAnswer; today: LocalDay },
): AnswerOpenSymptomResult {
  const row = db
    .prepare("SELECT person_id, start_date, end_date, is_resolved FROM symptom_events WHERE id = ?")
    .get(input.symptomId) as { person_id: number; start_date: string; end_date: string | null; is_resolved: number } | undefined
  if (!row) return { ok: false, status: 404, error: "Not found" }
  if (row.is_resolved === 1 || row.end_date !== null) {
    return { ok: false, status: 409, error: "This symptom is no longer open" }
  }

  if (input.answer.outcome === "ongoing") {
    db.prepare("UPDATE symptom_events SET ongoing_confirmed_on = ? WHERE id = ?").run(input.today.ymd, input.symptomId)
    return { ok: true, outcome: "ongoing", personId: row.person_id }
  }

  const resolvedYmd = input.answer.resolvedYmd ?? input.today.ymd
  if (!YMD_RE.test(resolvedYmd)) return { ok: false, status: 400, error: "resolved date must be a valid date (YYYY-MM-DD)" }
  const startYmd = utcMsToLocalYmd(Date.parse(row.start_date), input.today.offsetMinutes)
  if (resolvedYmd > input.today.ymd) return { ok: false, status: 400, error: "resolved date cannot be in the future" }
  if (resolvedYmd < startYmd) return { ok: false, status: 400, error: "resolved date cannot be before the symptom started" }
  const endMs = localCalendarYmdHmToUtcMs(resolvedYmd, "00:00", input.today.offsetMinutes)
  if (!Number.isFinite(endMs)) return { ok: false, status: 400, error: "resolved date must be a valid date (YYYY-MM-DD)" }

  db.prepare("UPDATE symptom_events SET is_resolved = 1, resolved_at = ?, end_date = ? WHERE id = ?")
    .run(nextResolvedAt(true, false, null), new Date(endMs).toISOString(), input.symptomId)
  return { ok: true, outcome: "resolved", personId: row.person_id }
}
