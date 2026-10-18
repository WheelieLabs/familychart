// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import type { PortablePersonSettings } from "@/lib/export/portable-user-settings"
import { loadPortablePersonSettings } from "@/lib/export/portable-user-settings"
import { parseTestAttachmentUrl } from "@/lib/test-results/attachment-url"

/**
 * The structured Person payload: the importer's only source of truth. Every `id` and `*_id`
 * reference is a bundle-local id (unique per kind within the file); `db_id` is the producing
 * instance's row id, informational only and never used to restore.
 */
export interface PersonExportPayload {
  person: PersonPayload
  medications: MedicationPayload[]
  assignments: AssignmentPayload[]
  administrations: AdministrationPayload[]
  observations: ObservationPayload[]
  test_results: TestResultPayload[]
  symptoms: SymptomPayload[]
  symptom_dose_links: SymptomDoseLinkPayload[]
  observation_goals: ObservationGoalPayload[]
  observation_expectations: ObservationExpectationPayload[]
  /** What happened to each Scheduled slot. Absent on an export made before slot outcomes existed. */
  slot_outcomes?: SlotOutcomePayload[]
  catalogues: { observation_types: CatalogueFlag[]; test_metrics: CatalogueFlag[] }
  /** This Person's own settings, held by their Personal-link Account. Absent on an older export. */
  user_settings?: PortablePersonSettings
}

/** A stored file: its path inside the export (null when it could not be included) and its stored name. */
export interface StoredFileRef {
  file: string | null
  original_name: string
}

export interface PersonPayload {
  id: number
  db_id: number
  name: string
  full_name: string | null
  date_of_birth: string | null
  color: string
  is_active: number
  photo: StoredFileRef | null
}

export interface FrequencyRulePayload {
  min_hours_between: number
  max_hours_between: number | null
  max_quantity_per_24h: number | null
  max_quantity_unit: string | null
  min_age_years: number | null
  max_age_years: number | null
  dosage: number | null
  min_weight_kg: number | null
  max_weight_kg: number | null
  max_per_24h_count_doses: number
}

export interface MedicationPayload {
  id: number
  db_id: number
  name: string
  default_dosage: number | null
  dosage_unit: string
  min_age_years: number | null
  max_age_years: number | null
  notes: string | null
  is_active: number
  frequency_rules: FrequencyRulePayload[]
}

export interface DoseExpectationOutcomePayload {
  local_ymd: string
  status: string
  snoozed_until: string | null
  slot_at: string | null
  administration_id: number | null
  resolved_by: string | null
  resolved_at: string | null
}

export interface DoseExpectationPayload {
  id: number
  db_id: number
  slot_hhmm: string
  start_date: string
  end_date: string
  weekdays: string | null
  created_by: string | null
  created_at: string | null
  /** Local days skipped. */
  exceptions: string[]
  outcomes: DoseExpectationOutcomePayload[]
}

/** A Person-medication assignment with its schedule. */
export interface AssignmentPayload {
  id: number
  db_id: number
  medication_id: number
  is_active: number
  schedule_times: string | null
  schedule_frequency: string | null
  schedule_start_date: string | null
  schedule_end_date: string | null
  schedule_slots: string | null
  schedule_tz: string | null
  /** Epoch ms the schedule was created; absent in exports made before it existed. */
  schedule_created_at_ms?: number | null
  dose_expectations: DoseExpectationPayload[]
}

/**
 * One Scheduled slot's outcome. Both references are bundle-local: `assignment_id` is an assignment
 * in this payload and `administration_id` the attached dose (null for a Missed slot).
 */
export interface SlotOutcomePayload {
  assignment_id: number
  local_ymd: string
  slot_hhmm: string
  result: string
  offset_minutes: number | null
  missed_cause: string | null
  administration_id: number | null
  /** When the outcome was settled (UTC, `YYYY-MM-DD HH:MM:SS`). The dashboard's "today" Missed line reads it. Absent on an older export. */
  created_at?: string | null
}

export interface ObservationGoalPayload {
  observation_type: string
  goal_type: string
  target_value: number
  target_max: number | null
  unit: string
  is_active: number
  target_date: string | null
}

export interface ObservationExpectationPayload {
  observation_type: string
  cadence: string
  interval_days: number | null
  recurrence_day_of_month: number | null
  recurrence_month: number | null
  recurrence_day: number | null
  recurrence_use_birthday: number
  enabled: number
  due_time_hhmm: string
  tz: string | null
}

/** A curated catalogue entry: the app's own definition is never carried, only whether it is on. */
export interface CatalogueFlag {
  name: string
  is_active: number
}

export interface AdministrationPayload {
  id: number
  db_id: number
  medication_id: number
  recorded_at: string
  dosage: number | null
  dosage_unit: string | null
  comments: string | null
  administered_by: string | null
  created_by: string | null
  created_at: string | null
}

export interface ObservationPayload {
  id: number
  db_id: number
  observation_type: string
  value: number
  unit: string
  value_label: string | null
  recorded_at: string
  comments: string | null
  /** Bundle-local reading group, shared by the fields of one multi-field reading such as blood pressure. */
  group_id: number | null
  created_by: string | null
  created_at: string | null
}

export interface TestResultValuePayload {
  metric_name: string
  value_type: string
  numeric_value: number | null
  qualitative_value: string | null
  unit: string | null
  reference_range: string | null
  flag: string | null
  limit_qualifier: string | null
}

export interface TestResultPayload {
  id: number
  db_id: number
  test_type: string
  name: string
  date: string
  ordered_by: string | null
  notes: string | null
  report: StoredFileRef | null
  created_by: string | null
  created_at: string | null
  values: TestResultValuePayload[]
}

export interface SymptomPayload {
  id: number
  db_id: number
  label: string
  /** As stored: a symptom day is kept as the instant of local midnight. */
  start_date: string
  end_date: string | null
  severity: number
  is_resolved: number
  resolved_at: string | null
  notes: string | null
  ongoing_confirmed_on: string | null
  created_by: string | null
  created_at: string | null
}

export interface SymptomDoseLinkPayload {
  symptom_id: number
  administration_id: number
  created_by: string | null
  created_at: string | null
}

/** Hands out bundle-local ids 1, 2, 3… for one kind of thing, keyed by its database id. */
class BundleIds<K = number> {
  private readonly ids = new Map<K, number>()

  assign(key: K): number {
    let id = this.ids.get(key)
    if (id === undefined) {
      id = this.ids.size + 1
      this.ids.set(key, id)
    }
    return id
  }

  get(key: K): number | undefined {
    return this.ids.get(key)
  }
}

function storedName(url: string | null): string | null {
  return url ? (url.split("/").pop() || null) : null
}

/**
 * Gathers a Person's structured payload, including inactive Persons. File references carry the
 * stored name with `file: null`; the export builder fills in the path of each file it includes.
 * Returns null when the Person doesn't exist.
 */
export function loadPersonExportPayload(db: Database.Database, personId: number, personBundleId = 1): PersonExportPayload | null {
  const personRow = db
    .prepare("SELECT id, name, full_name, date_of_birth, color, is_active, photo_url FROM people WHERE id = ?")
    .get(personId) as { id: number; name: string; full_name: string | null; date_of_birth: string | null; color: string; is_active: number; photo_url: string | null } | undefined
  if (!personRow) return null

  const photoName = storedName(personRow.photo_url)
  const person: PersonPayload = {
    id: personBundleId,
    db_id: personRow.id,
    name: personRow.name,
    full_name: personRow.full_name,
    date_of_birth: personRow.date_of_birth,
    color: personRow.color,
    is_active: personRow.is_active,
    photo: photoName ? { file: null, original_name: photoName } : null,
  }

  const ruleStmt = db.prepare(
    `SELECT min_hours_between, max_hours_between, max_quantity_per_24h, max_quantity_unit, min_age_years, max_age_years,
            dosage, min_weight_kg, max_weight_kg, max_per_24h_count_doses
     FROM medication_frequency_rules WHERE medication_id = ?
     ORDER BY id ASC`,
  )
  const medicationIds = new BundleIds()
  const medications = (db
    .prepare(
      `SELECT id, name, default_dosage, dosage_unit, min_age_years, max_age_years, notes, is_active FROM medications
       WHERE id IN (SELECT medication_id FROM person_medications WHERE person_id = ?)
          OR id IN (SELECT medication_id FROM medication_records WHERE person_id = ?)
       ORDER BY name COLLATE NOCASE ASC, id ASC`,
    )
    .all(personId, personId) as (Omit<MedicationPayload, "db_id" | "frequency_rules"> & { id: number })[]).map(m => ({
      ...m,
      id: medicationIds.assign(m.id),
      db_id: m.id,
      frequency_rules: ruleStmt.all(m.id) as FrequencyRulePayload[],
    }))

  const administrationIds = new BundleIds()
  const administrations = (db
    .prepare(
      `SELECT id, medication_id, recorded_at, dosage, dosage_unit, comments, administered_by, created_by, created_at
       FROM medication_records WHERE person_id = ?
       ORDER BY recorded_at ASC, id ASC`,
    )
    .all(personId) as (Omit<AdministrationPayload, "db_id"> & { id: number })[]).map(r => ({
      ...r,
      id: administrationIds.assign(r.id),
      db_id: r.id,
      medication_id: medicationIds.get(r.medication_id)!,
    }))

  const observationIds = new BundleIds()
  const groupIds = new BundleIds<string>()
  const observations = (db
    .prepare(
      `SELECT id, observation_type, value, unit, value_label, recorded_at, comments, session_id, created_by, created_at
       FROM observations WHERE person_id = ?
       ORDER BY recorded_at ASC, id ASC`,
    )
    .all(personId) as (Omit<ObservationPayload, "db_id" | "group_id"> & { session_id: string | null })[]).map(
      ({ session_id, ...r }) => ({
        ...r,
        id: observationIds.assign(r.id),
        db_id: r.id,
        group_id: session_id ? groupIds.assign(session_id) : null,
      }),
    )

  const valueStmt = db.prepare(
    `SELECT metric_name, value_type, numeric_value, qualitative_value, unit, reference_range, flag, limit_qualifier
     FROM test_result_values WHERE test_event_id = ?
     ORDER BY id ASC`,
  )
  const testResultIds = new BundleIds()
  const test_results = (db
    .prepare(
      `SELECT id, test_type, name, date, ordered_by, notes, attachment_url, created_by, created_at
       FROM test_events WHERE person_id = ?
       ORDER BY date ASC, id ASC`,
    )
    .all(personId) as (Omit<TestResultPayload, "db_id" | "report" | "values"> & { attachment_url: string | null })[]).map(
      ({ attachment_url, ...r }) => {
        const reportName = parseTestAttachmentUrl(attachment_url)
        return {
          ...r,
          id: testResultIds.assign(r.id),
          db_id: r.id,
          report: reportName ? { file: null, original_name: reportName } : null,
          values: valueStmt.all(r.id) as TestResultValuePayload[],
        }
      },
    )

  const symptomIds = new BundleIds()
  const symptoms = (db
    .prepare(
      `SELECT id, label, start_date, end_date, severity, is_resolved, resolved_at, notes, ongoing_confirmed_on, created_by, created_at
       FROM symptom_events WHERE person_id = ?
       ORDER BY start_date ASC, id ASC`,
    )
    .all(personId) as (Omit<SymptomPayload, "db_id"> & { id: number })[]).map(r => ({ ...r, id: symptomIds.assign(r.id), db_id: r.id }))

  const symptom_dose_links = (db
    .prepare(
      `SELECT symptom_event_id, medication_record_id, created_by, created_at
       FROM symptom_dose_links WHERE person_id = ?
       ORDER BY medication_record_id ASC, symptom_event_id ASC`,
    )
    .all(personId) as { symptom_event_id: number; medication_record_id: number; created_by: string | null; created_at: string | null }[])
    .filter(l => symptomIds.get(l.symptom_event_id) !== undefined && administrationIds.get(l.medication_record_id) !== undefined)
    .map(l => ({
      symptom_id: symptomIds.get(l.symptom_event_id)!,
      administration_id: administrationIds.get(l.medication_record_id)!,
      created_by: l.created_by,
      created_at: l.created_at,
    }))

  const exceptionStmt = db.prepare(
    "SELECT local_ymd FROM dose_expectation_exceptions WHERE dose_expectation_id = ? ORDER BY local_ymd ASC",
  )
  const outcomeStmt = db.prepare(
    `SELECT local_ymd, status, snoozed_until, slot_at, medication_record_id, resolved_by, resolved_at
     FROM dose_expectation_outcomes WHERE dose_expectation_id = ?
     ORDER BY local_ymd ASC`,
  )
  const expectationStmt = db.prepare(
    `SELECT id, slot_hhmm, start_date, end_date, weekdays, created_by, created_at
     FROM dose_expectations WHERE person_medication_id = ?
     ORDER BY start_date ASC, slot_hhmm ASC, id ASC`,
  )
  const assignmentIds = new BundleIds()
  const expectationIds = new BundleIds()
  const assignments = (db
    .prepare(
      `SELECT id, medication_id, is_active, schedule_times, schedule_frequency, schedule_start_date, schedule_end_date,
              schedule_slots, schedule_tz, schedule_created_at_ms
       FROM person_medications WHERE person_id = ?
       ORDER BY id ASC`,
    )
    .all(personId) as (Omit<AssignmentPayload, "db_id" | "dose_expectations"> & { id: number })[]).map(a => ({
      ...a,
      id: assignmentIds.assign(a.id),
      db_id: a.id,
      medication_id: medicationIds.get(a.medication_id)!,
      dose_expectations: (expectationStmt.all(a.id) as (Omit<DoseExpectationPayload, "db_id" | "exceptions" | "outcomes">)[]).map(e => ({
        ...e,
        id: expectationIds.assign(e.id),
        db_id: e.id,
        exceptions: (exceptionStmt.all(e.id) as { local_ymd: string }[]).map(x => x.local_ymd),
        outcomes: (outcomeStmt.all(e.id) as (Omit<DoseExpectationOutcomePayload, "administration_id"> & { medication_record_id: number | null })[]).map(
          ({ medication_record_id, ...o }) => ({
            ...o,
            administration_id: medication_record_id === null ? null : (administrationIds.get(medication_record_id) ?? null),
          }),
        ),
      })),
    }))

  const observation_goals = db
    .prepare(
      `SELECT observation_type, goal_type, target_value, target_max, unit, is_active, target_date
       FROM observation_goals WHERE person_id = ?
       ORDER BY observation_type COLLATE NOCASE ASC, goal_type ASC`,
    )
    .all(personId) as ObservationGoalPayload[]

  const observation_expectations = db
    .prepare(
      `SELECT observation_type, cadence, interval_days, recurrence_day_of_month, recurrence_month, recurrence_day,
              recurrence_use_birthday, enabled, due_time_hhmm, tz
       FROM person_observation_expectations WHERE person_id = ?
       ORDER BY observation_type COLLATE NOCASE ASC`,
    )
    .all(personId) as ObservationExpectationPayload[]

  // One range scan on the unique (person_medication_id, local_ymd, slot_hhmm) index, never one query per row.
  const slot_outcomes: SlotOutcomePayload[] = []
  for (const row of db
    .prepare(
      `SELECT person_medication_id, local_ymd, slot_hhmm, result, offset_minutes, missed_cause, medication_record_id, created_at
       FROM slot_outcomes
       WHERE person_medication_id IN (SELECT id FROM person_medications WHERE person_id = ?)
       ORDER BY person_medication_id ASC, local_ymd ASC, slot_hhmm ASC`,
    )
    .iterate(personId) as Iterable<{
      person_medication_id: number; local_ymd: string; slot_hhmm: string; result: string
      offset_minutes: number | null; missed_cause: string | null; medication_record_id: number | null
      created_at: string | null
    }>) {
    const assignmentId = assignmentIds.get(row.person_medication_id)
    if (assignmentId === undefined) continue
    slot_outcomes.push({
      assignment_id: assignmentId,
      local_ymd: row.local_ymd,
      slot_hhmm: row.slot_hhmm,
      result: row.result,
      offset_minutes: row.offset_minutes,
      missed_cause: row.missed_cause,
      administration_id: row.medication_record_id === null ? null : (administrationIds.get(row.medication_record_id) ?? null),
      created_at: row.created_at,
    })
  }

  return {
    person,
    medications,
    assignments,
    administrations,
    observations,
    test_results,
    symptoms,
    symptom_dose_links,
    observation_goals,
    observation_expectations,
    slot_outcomes,
    catalogues: loadCatalogueFlags(db),
    user_settings: loadPortablePersonSettings(db, personId, personBundleId),
  }
}

/** The curated catalogues as name and on/off flag only. */
export function loadCatalogueFlags(db: Database.Database): PersonExportPayload["catalogues"] {
  return {
    observation_types: db
      .prepare("SELECT observation_type AS name, is_active FROM observation_type_config ORDER BY sort_order ASC, observation_type COLLATE NOCASE ASC")
      .all() as CatalogueFlag[],
    test_metrics: db
      .prepare("SELECT metric_name AS name, is_active FROM test_metric_config ORDER BY sort_order ASC, metric_name COLLATE NOCASE ASC")
      .all() as CatalogueFlag[],
  }
}
