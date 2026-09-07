// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireRead, requireWrite } from "@/lib/auth/auth-helpers"
import { rejectDemoProfanity } from "@/lib/demo/demo-profanity-guard"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import type { Medication } from "@/lib/domain-types"
import { fractionalAgeYears } from "@/lib/person/person-age"
import { resolveAgeTimezone } from "@/lib/instance-timezone"
import { canManage, canReadForPerson } from "@/lib/permissions"
import { loadMedicationDoseState, doseSliceFromMaps } from "@/lib/medication/medication-dose-state"
import { parseScheduleTimesJson } from "@/lib/schedule/schedule-recurrence"
import { resolveCalendarContext } from "@/lib/calendar-context"

interface MedGroup { id: number; name: string }

function parseGroups(raw: string | null): MedGroup[] {
  if (!raw) return []
  return raw.split("|").map(s => {
    const colon = s.indexOf(":")
    return { id: parseInt(s.slice(0, colon), 10), name: s.slice(colon + 1) }
  })
}

const GROUP_JOIN = `
  LEFT JOIN medication_group_members mgm ON mgm.medication_id = m.id
  LEFT JOIN medication_groups mg ON mg.id = mgm.group_id AND mg.is_active = 1
`
const GROUP_AGG = `GROUP_CONCAT(mg.id || ':' || mg.name, '|') as groups_raw`

/** Substring LIKE pattern; escapes `%`, `_`, and `\` for use with `ESCAPE '\'`. */
function sqlLikeSubstringPattern(raw: string): string {
  return `%${raw
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")}%`
}

export async function GET(request: NextRequest) {
  const authResult = await requireRead()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult

  const { searchParams } = new URL(request.url)
  const q              = searchParams.get("q")?.trim()
  const personId       = searchParams.get("person_id")
  const medicationIdRaw = searchParams.get("medication_id")
  const db             = getDb()

  let personAge: number | null = null
  let personDateOfBirth: string | null = null
  if (personId) {
    const pid = parseInt(personId, 10)
    const person = db.prepare(
      "SELECT date_of_birth, account_uid FROM people WHERE id = ? AND is_active = 1"
    ).get(pid) as { date_of_birth: string | null; account_uid: string | null } | undefined
    if (!person) return NextResponse.json([])
    if (!canReadForPerson(groups, session.user, person.account_uid)) {
      return NextResponse.json([])
    }
    personDateOfBirth = person.date_of_birth
    if (person.date_of_birth) personAge = fractionalAgeYears(person.date_of_birth, resolveAgeTimezone(db))
  }

  const ageClause = personAge !== null
    ? `AND (m.min_age_years IS NULL OR ${personAge} >= m.min_age_years)
       AND (m.max_age_years IS NULL OR ${personAge} <= m.max_age_years)`
    : ""

  if (medicationIdRaw && personId) {
    const pid = parseInt(personId, 10)
    const mid = parseInt(medicationIdRaw, 10)
    if (!Number.isFinite(pid) || !Number.isFinite(mid)) {
      return NextResponse.json([])
    }
    // No age filter on the medication_id lookup: this is a deep-link prefill for
    // a specific, already-prescribed medication, not a catalogue search. The age
    // filter belongs only on the `q` typeahead.
    const row = db.prepare(
      `SELECT m.*, ${GROUP_AGG}
       FROM medications m ${GROUP_JOIN}
       WHERE m.id = ? AND m.is_active = 1
       GROUP BY m.id`
    ).get(mid) as (Medication & { groups_raw: string | null }) | undefined
    if (!row) return NextResponse.json([])
    const meds = [{ ...row, groups: parseGroups(row.groups_raw) }]
    const doseState = loadMedicationDoseState(db, [{ id: pid, date_of_birth: personDateOfBirth }])
    const serverNow = new Date().toISOString()
    const schedRows = db.prepare(
      `SELECT id AS person_medication_id, medication_id, schedule_times, schedule_frequency,
              schedule_start_date, schedule_end_date, schedule_tz
       FROM person_medications WHERE person_id = ? AND is_active = 1`
    ).all(pid) as {
      person_medication_id: number; medication_id: number
      schedule_times: string | null; schedule_frequency: string | null
      schedule_start_date: string | null; schedule_end_date: string | null
      schedule_tz: string | null
    }[]
    const schedByMedId = new Map(schedRows.map(r => [r.medication_id, r]))
    return NextResponse.json(meds.map(med => {
      const slice = doseSliceFromMaps(doseState, pid, med.id)
      const sched = schedByMedId.get(med.id)
      return {
        ...med,
        server_now: serverNow,
        applicable_rule: slice.rule,
        total_taken_24h: slice.total24h,
        last_dose_at: slice.lastDose?.lastIso ?? null,
        last_dose_med_name: slice.lastDose?.lastMedName ?? null,
        last_dose_remind_after_hours: slice.lastDose?.remindAfterHours ?? null,
        last_dosage: slice.lastDosage,
        oldest_in_window_at: slice.oldest24h,
        person_medication_id: sched?.person_medication_id ?? null,
        schedule_times: parseScheduleTimesJson(sched?.schedule_times ?? null),
        schedule_frequency: sched?.schedule_frequency ?? null,
        schedule_start_date: sched?.schedule_start_date ?? null,
        schedule_end_date: sched?.schedule_end_date ?? null,
        // Server-resolved (incl. DB-backed instance-IANA fallback) so the client never
        // has to replicate resolveEffectiveIanaTz itself for its suppression-checkbox preview.
        schedule_calendar_context: sched
          ? resolveCalendarContext(db, sched.schedule_tz, Date.now(), request)
          : null,
      }
    }))
  }

  if (q) {
    const pid = personId ? parseInt(personId, 10) : null
    const likePat = sqlLikeSubstringPattern(q)
    const rows = db.prepare(
      `SELECT m.*, ${GROUP_AGG}
       FROM medications m ${GROUP_JOIN}
       WHERE m.name LIKE ? ESCAPE '` +
        '\\' +
        `' AND m.is_active = 1 ${ageClause}
       GROUP BY m.id
       ORDER BY m.name COLLATE NOCASE LIMIT 10`
    ).all(likePat) as (Medication & { groups_raw: string | null })[]

    const meds = rows.map(r => ({ ...r, groups: parseGroups(r.groups_raw) }))

    if (!pid) return NextResponse.json(meds)

    const doseState = loadMedicationDoseState(db, [{ id: pid, date_of_birth: personDateOfBirth }])
    const serverNow = new Date().toISOString()
    const schedRows2 = db.prepare(
      `SELECT id AS person_medication_id, medication_id, schedule_times, schedule_frequency,
              schedule_start_date, schedule_end_date, schedule_tz
       FROM person_medications WHERE person_id = ? AND is_active = 1`
    ).all(pid) as {
      person_medication_id: number; medication_id: number
      schedule_times: string | null; schedule_frequency: string | null
      schedule_start_date: string | null; schedule_end_date: string | null
      schedule_tz: string | null
    }[]
    const schedByMedId2 = new Map(schedRows2.map(r => [r.medication_id, r]))
    return NextResponse.json(meds.map(med => {
      const slice = doseSliceFromMaps(doseState, pid, med.id)
      const sched = schedByMedId2.get(med.id)
      return {
        ...med,
        server_now: serverNow,
        applicable_rule: slice.rule,
        total_taken_24h: slice.total24h,
        last_dose_at: slice.lastDose?.lastIso ?? null,
        last_dose_med_name: slice.lastDose?.lastMedName ?? null,
        last_dose_remind_after_hours: slice.lastDose?.remindAfterHours ?? null,
        last_dosage: slice.lastDosage,
        oldest_in_window_at: slice.oldest24h,
        person_medication_id: sched?.person_medication_id ?? null,
        schedule_times: parseScheduleTimesJson(sched?.schedule_times ?? null),
        schedule_frequency: sched?.schedule_frequency ?? null,
        schedule_start_date: sched?.schedule_start_date ?? null,
        schedule_end_date: sched?.schedule_end_date ?? null,
        schedule_calendar_context: sched
          ? resolveCalendarContext(db, sched.schedule_tz, Date.now(), request)
          : null,
      }
    }))
  }

  const includeInactive = searchParams.get("include_inactive") === "1"
  if (!canManage(groups)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const rows = db.prepare(
    `SELECT m.*, ${GROUP_AGG}
     FROM medications m ${GROUP_JOIN}
     WHERE ${includeInactive ? "1=1" : "m.is_active = 1"}
     GROUP BY m.id
     ORDER BY m.name`
  ).all() as (Medication & { groups_raw: string | null })[]

  return NextResponse.json(rows.map(r => ({ ...r, groups: parseGroups(r.groups_raw) })))
}

export async function POST(request: NextRequest) {
  const authResult = await requireWrite()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult
  const body = await request.json()
  const { name, default_dosage, dosage_unit, notes, min_age_years, max_age_years } = body
  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 })
  const profanity = await rejectDemoProfanity(name, notes)
  if (profanity) return profanity
  const db = getDb()
  const existing = db.prepare("SELECT * FROM medications WHERE name = ? COLLATE NOCASE").get(name.trim()) as Medication | undefined
  if (existing) return NextResponse.json(existing)
  const result = db.prepare(
    "INSERT INTO medications (name, default_dosage, dosage_unit, notes, min_age_years, max_age_years) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(name.trim(), default_dosage ?? null, dosage_unit ?? "Tabs",
        notes ?? null, min_age_years ?? null, max_age_years ?? null)
  auditLog(db, session.user?.email, "CREATE", "medications", Number(result.lastInsertRowid), { name })
  return NextResponse.json(db.prepare("SELECT * FROM medications WHERE id = ?").get(result.lastInsertRowid), { status: 201 })
}
