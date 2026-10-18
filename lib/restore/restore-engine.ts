// SPDX-License-Identifier: AGPL-3.0-only

import { randomUUID } from "crypto"
import { extname } from "path"
import type Database from "better-sqlite3-multiple-ciphers"
import { auditLog } from "@/lib/audit-log"
import type { ExportManifest } from "@/lib/export/export-manifest"
import { validateRecordDosage, validateRecordAdministeredBy, validateRecordTiming } from "@/lib/medication/medication-record-validation"
import { normaliseMedicationDosageUnitAlias } from "@/lib/medication/medication-units"
import { findObservationTypeConfig } from "@/lib/observation/observation-type-meta"
import { validateObservationWrite } from "@/lib/observation/observation-validation"
import { validateObservationExpectation } from "@/lib/observation/observation-expectation-validation"
import type {
  AdministrationPayload,
  AssignmentPayload,
  DoseExpectationPayload,
  MedicationPayload,
  ObservationPayload,
  PersonExportPayload,
  TestResultPayload,
} from "@/lib/person/person-export-payload"
import { findTestMetricConfig } from "@/lib/test-results/test-metric-meta"
import { validateTestEventWrite, validateTestResultValueWrite } from "@/lib/test-results/test-result-validation"
import type { UploadBucket } from "@/lib/uploads/store"
import { NOT_AN_EXPORT } from "./messages"
import {
  applyRestoreAccounts,
  planRestoreAccounts,
  type PendingInviteMail,
  type RestoreAccountChoice,
  type RestoreAccountsPlan,
  type RestoreAccountsResult,
} from "./restore-accounts"
import { restoreFavourites, type RestoreFavouritesReport } from "./restore-favourites"
import { restoreSettings, type RestoreSettingsReport } from "./restore-settings"
import {
  PersonSignInError,
  restoreHouseholdUserSettings,
  restorePersonSignIn,
  type PersonSignInChoice,
  type RestoreUserSettingsReport,
} from "./restore-user-settings"
import { StageError } from "./stage-store"
import { ZipFile, ZipReadError } from "./zip-file"
import type { AppUser } from "@/lib/session"

export type PersonAction = "new" | "map" | "skip"
export type MedicationAction = "new" | "map"

export interface PersonChoice {
  bundle_id: number
  action: PersonAction
  target_id: number | null
}

export interface MedicationChoice {
  bundle_id: number
  action: MedicationAction
  target_id: number | null
}

export interface RestoreDecisions {
  persons: PersonChoice[]
  medications: MedicationChoice[]
  accounts?: RestoreAccountChoice[]
  /** Person export only. Blank email carries no personal settings. */
  person_sign_ins?: PersonSignInChoice[]
}

export interface RestoreDifference {
  kind: "frequency_rule" | "schedule" | "observation_goal" | "observation_expectation" | "test_result_value" | "dose_outcome"
  medication?: string
  person?: string
  observation_type?: string
  test_name?: string
  metric?: string
  local_ymd?: string
  field: string
  existing: unknown
  export: unknown
}

export interface RestoreWarning {
  kind: "skipped_file" | "unknown_catalogue" | "date_of_birth_mismatch"
  path?: string
  reason?: string
  catalogue?: "observation_type" | "test_metric"
  name?: string
  export_date_of_birth?: string | null
  existing_date_of_birth?: string | null
  existing_id?: number
}

export interface FileJob {
  zipPath: string
  bucket: UploadBucket
  filename: string
  /** Bundle path reported if this write fails. */
  bundlePath: string
  url: string
}

const COUNT_KEYS = [
  "persons", "medications", "frequency_rules", "assignments", "administrations",
  "observations", "test_results", "test_result_values", "symptoms", "symptom_dose_links",
  "observation_goals", "observation_expectations", "dose_expectations",
  "dose_expectation_exceptions", "dose_expectation_outcomes", "slot_outcomes",
] as const

export type RestoreCounts = Record<(typeof COUNT_KEYS)[number], number>

function emptyCounts(): RestoreCounts {
  return Object.fromEntries(COUNT_KEYS.map(key => [key, 0])) as RestoreCounts
}

function sumCounts(counts: RestoreCounts): number {
  return COUNT_KEYS.reduce((total, key) => total + counts[key], 0)
}

export class RestoreError extends Error {
  constructor(message: string, readonly status: number, readonly extra?: Record<string, unknown>) {
    super(message)
    this.name = "RestoreError"
  }
}

interface PayloadSource {
  payload: PersonExportPayload
}

interface ResolvedPerson {
  source: PayloadSource
  action: PersonAction
  /** Database id once known. Null while a new Person has not been inserted. */
  targetId: number | null
}

interface ResolvedMedication {
  medication: MedicationPayload
  action: MedicationAction
  targetId: number | null
}

export interface Assessment {
  id: string
  format_version: number
  scope: ExportManifest["scope"]
  app_version: string
  exported_at: string
  persons: {
    bundle_id: number
    name: string
    date_of_birth: string | null
    suggested_action: PersonAction
    target_id: number | null
  }[]
  medications: {
    bundle_id: number
    name: string
    suggested_action: MedicationAction
    target_id: number | null
  }[]
  differences: RestoreDifference[]
  warnings: RestoreWarning[]
  counts: { new: number; duplicate: number; differing: number; skipped: number }
  created: RestoreCounts
  duplicates: RestoreCounts
  skipped_unknown: { catalogue: "observation_type" | "test_metric"; name: string; count: number }[]
  mapped: { persons: number; medications: number }
  file_jobs: FileJob[]
  accounts: RestoreAccountsPlan
  favourites: RestoreFavouritesReport | "not restored"
  settings: RestoreSettingsReport | "not restored"
  user_settings: RestoreUserSettingsReport | "not restored"
  /** Present only while applying; stripped before the API response. */
  pending_invite_mails?: PendingInviteMail[]
  accounts_result?: RestoreAccountsResult
}

const RULE_FIELDS = [
  "min_hours_between", "max_hours_between", "max_quantity_per_24h", "max_quantity_unit",
  "min_age_years", "max_age_years", "dosage", "min_weight_kg", "max_weight_kg", "max_per_24h_count_doses",
] as const

const SCHEDULE_FIELDS = [
  "is_active", "schedule_times", "schedule_frequency", "schedule_start_date", "schedule_end_date",
  "schedule_slots", "schedule_tz",
] as const

function same(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true
  return a === b
}

function parsePersonPayload(raw: Buffer): PersonExportPayload {
  let parsed: PersonExportPayload
  try {
    parsed = JSON.parse(raw.toString("utf8")) as PersonExportPayload
  } catch {
    throw new StageError(NOT_AN_EXPORT, 400)
  }
  if (!parsed?.person || typeof parsed.person.name !== "string" || typeof parsed.person.id !== "number") {
    throw new StageError(NOT_AN_EXPORT, 400)
  }
  return parsed
}

/** Household exports nest each Person under `people/<n>/`; prefix attachment paths for the staged zip. */
function prefixStoredFiles(payload: PersonExportPayload, folderPrefix: string): void {
  if (payload.person.photo?.file) payload.person.photo.file = folderPrefix + payload.person.photo.file
  for (const result of payload.test_results ?? []) {
    if (result.report?.file) result.report.file = folderPrefix + result.report.file
  }
}

/**
 * Each Person folder carries bundle-local ids starting at 1. Assign stable ids across the
 * household and share one bundle id per medication name.
 */
function mergeHouseholdPayloads(payloads: PersonExportPayload[]): PersonExportPayload[] {
  let nextPersonId = 1
  let nextMedId = 1
  const medIdByName = new Map<string, number>()

  for (const payload of payloads) {
    payload.person.id = nextPersonId++
    const medMap = new Map<number, number>()
    for (const med of payload.medications ?? []) {
      const key = med.name.toLowerCase()
      let globalId = medIdByName.get(key)
      if (globalId === undefined) {
        globalId = nextMedId++
        medIdByName.set(key, globalId)
      }
      medMap.set(med.id, globalId)
    }
    for (const med of payload.medications ?? []) {
      med.id = medMap.get(med.id)!
    }
    const mapMed = (id: number) => medMap.get(id) ?? id
    for (const row of payload.assignments ?? []) row.medication_id = mapMed(row.medication_id)
    for (const row of payload.administrations ?? []) row.medication_id = mapMed(row.medication_id)
  }
  return payloads
}

function readPayloads(zipPath: string, scope: ExportManifest["scope"]): PersonExportPayload[] {
  let zip: ZipFile
  try {
    zip = ZipFile.open(zipPath)
  } catch (err) {
    if (err instanceof ZipReadError) throw new StageError(err.message, 400)
    throw err
  }
  try {
    if (scope === "household") {
      const entryNames = zip.entries
        .map(entry => entry.name)
        .filter(name => /^people\/\d+\/person\.json$/.test(name))
        .sort((a, b) => Number(a.match(/^people\/(\d+)\//)![1]) - Number(b.match(/^people\/(\d+)\//)![1]))
      if (entryNames.length === 0) throw new StageError(NOT_AN_EXPORT, 400)
      const payloads = entryNames.map(name => {
        const raw = zip.read(name)
        if (!raw) throw new StageError(NOT_AN_EXPORT, 400)
        const folderPrefix = name.slice(0, name.lastIndexOf("/") + 1)
        const parsed = parsePersonPayload(raw)
        prefixStoredFiles(parsed, folderPrefix)
        return parsed
      })
      return mergeHouseholdPayloads(payloads)
    }
    const raw = zip.read("person.json")
    if (!raw) throw new StageError(NOT_AN_EXPORT, 400)
    return [parsePersonPayload(raw)]
  } catch (err) {
    if (err instanceof ZipReadError) throw new StageError(err.message, 400)
    throw err
  } finally {
    zip.close()
  }
}

interface ExistingPerson { id: number; name: string; date_of_birth: string | null }

function suggest(
  db: Database.Database,
  payloads: PersonExportPayload[],
): { decisions: RestoreDecisions; warnings: RestoreWarning[] } {
  const people = db.prepare(
    "SELECT id, name, date_of_birth FROM people ORDER BY id ASC",
  ).all() as ExistingPerson[]
  const medications = db.prepare("SELECT id, name FROM medications ORDER BY id ASC").all() as { id: number; name: string }[]
  const warnings: RestoreWarning[] = []
  const persons: PersonChoice[] = []
  const kept = new Set<number>()

  for (const payload of payloads) {
    const person = payload.person
    const exact = people.find(row =>
      row.name === person.name && (row.date_of_birth ?? null) === (person.date_of_birth ?? null))
    for (const row of people) {
      if (row.name === person.name && (row.date_of_birth ?? null) !== (person.date_of_birth ?? null)) {
        warnings.push({
          kind: "date_of_birth_mismatch",
          name: person.name,
          export_date_of_birth: person.date_of_birth,
          existing_date_of_birth: row.date_of_birth,
          existing_id: row.id,
        })
      }
    }
    if (exact) {
      persons.push({ bundle_id: person.id, action: "map", target_id: exact.id })
      kept.add(person.id)
    } else {
      persons.push({ bundle_id: person.id, action: "new", target_id: null })
      kept.add(person.id)
    }
  }

  const medicationsOut: MedicationChoice[] = []
  const seenMedicationBundle = new Set<number>()
  for (const payload of payloads) {
    if (!kept.has(payload.person.id)) continue
    for (const medication of payload.medications ?? []) {
      if (seenMedicationBundle.has(medication.id)) continue
      seenMedicationBundle.add(medication.id)
      const match = medications.find(row => row.name.toLowerCase() === medication.name.toLowerCase())
      medicationsOut.push(match
        ? { bundle_id: medication.id, action: "map", target_id: match.id }
        : { bundle_id: medication.id, action: "new", target_id: null })
    }
  }
  return { decisions: { persons, medications: medicationsOut }, warnings }
}

function decisionsFor(
  payloads: PersonExportPayload[],
  decisions: RestoreDecisions,
): { persons: ResolvedPerson[]; medications: Map<number, ResolvedMedication> } {
  const persons: ResolvedPerson[] = []
  for (const payload of payloads) {
    const choice = decisions.persons.find(row => row.bundle_id === payload.person.id)
    if (!choice) throw new RestoreError("Choose what to do with each Person", 400)
    if (choice.action !== "new" && choice.action !== "map" && choice.action !== "skip") {
      throw new RestoreError("Choose what to do with each Person", 400)
    }
    if (choice.action === "map" && (typeof choice.target_id !== "number" || !Number.isInteger(choice.target_id))) {
      throw new RestoreError("Choose which Person to map onto", 400)
    }
    persons.push({
      source: { payload },
      action: choice.action,
      targetId: choice.action === "map" ? choice.target_id : null,
    })
  }
  const medications = new Map<number, ResolvedMedication>()
  for (const payload of payloads) {
    for (const medication of payload.medications ?? []) {
      const choice = decisions.medications.find(row => row.bundle_id === medication.id)
      if (!choice || (choice.action !== "new" && choice.action !== "map")) {
        throw new RestoreError("Choose what to do with each medication", 400)
      }
      if (choice.action === "map" && (typeof choice.target_id !== "number" || !Number.isInteger(choice.target_id))) {
        throw new RestoreError("Choose which medication to map onto", 400)
      }
      medications.set(medication.id, {
        medication,
        action: choice.action,
        targetId: choice.action === "map" ? choice.target_id : null,
      })
    }
  }
  return { persons, medications }
}

function noteUnknown(
  skipped: Assessment["skipped_unknown"],
  warnings: RestoreWarning[],
  catalogue: "observation_type" | "test_metric",
  name: string,
) {
  const found = skipped.find(row => row.catalogue === catalogue && row.name === name)
  if (found) found.count += 1
  else skipped.push({ catalogue, name, count: 1 })
  if (!warnings.some(row => row.kind === "unknown_catalogue" && row.catalogue === catalogue && row.name === name)) {
    warnings.push({ kind: "unknown_catalogue", catalogue, name })
  }
}

function dosageUnit(raw: string | null): string | null {
  if (raw == null || raw.trim() === "") return null
  return normaliseMedicationDosageUnitAlias(raw)
}

function fileExt(bundlePath: string, fallback: string): string {
  const ext = extname(bundlePath).toLowerCase()
  return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : fallback
}

/**
 * Reads a staged export and says what applying `decisions` would do.
 * When `write` is set, inserts those rows in the caller's transaction.
 */
export function assessRestore(
  db: Database.Database,
  staged: { id: string; path: string; manifest: ExportManifest },
  decisions: RestoreDecisions | null,
  write: { actorEmail: string | null; inviter?: AppUser; origin?: string } | null,
): Assessment {
  const payloads = readPayloads(staged.path, staged.manifest.scope)
  const suggested = suggest(db, payloads)
  const chosen = decisions ?? suggested.decisions
  const { persons, medications } = decisionsFor(payloads, chosen)
  const differences: RestoreDifference[] = []
  const warnings: RestoreWarning[] = [...suggested.warnings]
  for (const file of staged.manifest.skipped_files) {
    warnings.push({ kind: "skipped_file", path: file.path, reason: file.reason })
  }
  const created = emptyCounts()
  const duplicates = emptyCounts()
  const skippedUnknown: Assessment["skipped_unknown"] = []
  const fileJobs: FileJob[] = []
  const writing = write != null
  const neededTypes = new Set<string>()
  const neededMetrics = new Set<string>()

  const activePersons = persons.filter(person => person.action !== "skip")
  for (const person of persons) {
    if (person.action === "skip") continue
    if (person.action === "map") {
      const row = db.prepare("SELECT id FROM people WHERE id = ?").get(person.targetId) as { id: number } | undefined
      if (!row) throw new RestoreError("The Person to map onto was not found", 400)
    }
  }

  const medIds = new Map<number, number>()
  for (const person of activePersons) {
    const payload = person.source.payload
    for (const medication of payload.medications ?? []) {
      const resolved = medications.get(medication.id)
      if (!resolved || medIds.has(medication.id)) continue
      if (resolved.action === "map") {
        const row = db.prepare("SELECT id, name FROM medications WHERE id = ?").get(resolved.targetId) as { id: number; name: string } | undefined
        if (!row) throw new RestoreError("The medication to map onto was not found", 400)
        medIds.set(medication.id, row.id)
        const existingRules = db.prepare(
          `SELECT ${RULE_FIELDS.join(", ")} FROM medication_frequency_rules WHERE medication_id = ? ORDER BY id ASC`,
        ).all(row.id) as Record<string, unknown>[]
        const exportedRules = medication.frequency_rules ?? []
        if (existingRules.length !== exportedRules.length) {
          differences.push({
            kind: "frequency_rule", medication: medication.name, field: "count",
            existing: existingRules.length, export: exportedRules.length,
          })
        } else {
          existingRules.forEach((existing, index) => {
            const exported = exportedRules[index] as unknown as Record<string, unknown>
            for (const field of RULE_FIELDS) {
              if (!same(existing[field], exported[field])) {
                differences.push({
                  kind: "frequency_rule", medication: medication.name, field,
                  existing: existing[field], export: exported[field],
                })
              }
            }
          })
        }
      } else {
        const clash = db.prepare("SELECT id FROM medications WHERE name = ? COLLATE NOCASE").get(medication.name) as { id: number } | undefined
        if (clash) throw new RestoreError(`A medication named ${medication.name} already exists; map it instead`, 400)
        if (writing) {
          const inserted = db.prepare(
            `INSERT INTO medications (name, default_dosage, dosage_unit, min_age_years, max_age_years, notes, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            medication.name, medication.default_dosage, medication.dosage_unit || "Tabs",
            medication.min_age_years, medication.max_age_years, medication.notes, medication.is_active ? 1 : 0,
          )
          const id = Number(inserted.lastInsertRowid)
          medIds.set(medication.id, id)
          resolved.targetId = id
          auditLog(db, write.actorEmail, "CREATE", "medications", id, { name: medication.name })
          for (const rule of medication.frequency_rules ?? []) {
            db.prepare(
              `INSERT INTO medication_frequency_rules
                (medication_id, min_hours_between, max_hours_between, max_quantity_per_24h, max_quantity_unit,
                 min_age_years, max_age_years, dosage, min_weight_kg, max_weight_kg, max_per_24h_count_doses)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run(
              id, rule.min_hours_between, rule.max_hours_between, rule.max_quantity_per_24h, rule.max_quantity_unit,
              rule.min_age_years, rule.max_age_years, rule.dosage, rule.min_weight_kg, rule.max_weight_kg,
              rule.max_per_24h_count_doses,
            )
            created.frequency_rules += 1
          }
        } else {
          // A negative id matches no row, so the preview can still count this medication's records.
          medIds.set(medication.id, -medication.id)
          created.frequency_rules += medication.frequency_rules?.length ?? 0
        }
        created.medications += 1
      }
    }
  }

  const personIds = new Map<number, number>()
  for (const person of activePersons) {
    const body = person.source.payload.person
    if (person.action === "new") {
      let photoUrl: string | null = null
      let photoJob: FileJob | null = null
      if (body.photo?.file) {
        const filename = `${randomUUID()}${fileExt(body.photo.file, ".jpg")}`
        photoUrl = `/api/uploads/${filename}`
        photoJob = { zipPath: body.photo.file, bucket: "people", filename, bundlePath: body.photo.file, url: photoUrl }
      }
      if (writing) {
        const inserted = db.prepare(
          `INSERT INTO people (name, full_name, date_of_birth, color, is_active, photo_url, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM people))`,
        ).run(body.name, body.full_name, body.date_of_birth, body.color || "#256AA5", body.is_active ? 1 : 0, photoUrl)
        person.targetId = Number(inserted.lastInsertRowid)
        auditLog(db, write.actorEmail, "CREATE", "people", person.targetId, {})
      }
      if (photoJob && writing) fileJobs.push(photoJob)
      created.persons += 1
    } else if (writing && body.photo?.file && person.targetId != null) {
      const row = db.prepare("SELECT photo_url FROM people WHERE id = ?").get(person.targetId) as { photo_url: string | null }
      if (!row.photo_url) {
        const filename = `${randomUUID()}${fileExt(body.photo.file, ".jpg")}`
        const url = `/api/uploads/${filename}`
        db.prepare("UPDATE people SET photo_url = ? WHERE id = ?").run(url, person.targetId)
        fileJobs.push({ zipPath: body.photo.file, bucket: "people", filename, bundlePath: body.photo.file, url })
      }
    }
    if (person.targetId != null) personIds.set(body.id, person.targetId)
  }

  for (const person of activePersons) {
    const payload = person.source.payload
    const personId = person.targetId
    const personName = payload.person.name
    const assignmentIds = new Map<number, number>()
    // Bundle ids that restore (or would, in a preview): slot outcomes follow only these.
    const restorableAssignments = new Set<number>()
    const restorableDoses = new Set<number>()

    for (const assignment of payload.assignments ?? []) {
      const medication = medications.get(assignment.medication_id)
      const medicationId = medication ? medIds.get(medication.medication.id) : undefined
      if (!medication || medicationId == null) continue
      restorableAssignments.add(assignment.id)
      const existing = personId == null ? undefined : db.prepare(
        `SELECT id, is_active, schedule_times, schedule_frequency, schedule_start_date, schedule_end_date, schedule_slots, schedule_tz
         FROM person_medications WHERE person_id = ? AND medication_id = ?`,
      ).get(personId, medicationId) as (AssignmentPayload & { id: number }) | undefined
      if (existing) {
        assignmentIds.set(assignment.id, existing.id)
        for (const field of SCHEDULE_FIELDS) {
          if (!same(existing[field], assignment[field])) {
            differences.push({
              kind: "schedule", person: personName, medication: medication.medication.name, field,
              existing: existing[field], export: assignment[field],
            })
          }
        }
        duplicates.assignments += 1
      } else {
        if (writing && personId != null) {
          const inserted = db.prepare(
            `INSERT INTO person_medications
              (person_id, medication_id, is_active, schedule_times, schedule_frequency, schedule_start_date,
               schedule_end_date, schedule_slots, schedule_tz, schedule_created_at_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            personId, medicationId, assignment.is_active ? 1 : 0, assignment.schedule_times, assignment.schedule_frequency,
            assignment.schedule_start_date, assignment.schedule_end_date, assignment.schedule_slots, assignment.schedule_tz,
            assignment.schedule_created_at_ms ?? null,
          )
          assignmentIds.set(assignment.id, Number(inserted.lastInsertRowid))
        }
        created.assignments += 1
      }
      restoreDoseExpectations(db, assignment, assignmentIds.get(assignment.id) ?? null, medication.medication.name, writing, write, created, duplicates, differences, new Map())
    }

    const administrationIds = new Map<number, number>()
    for (const dose of payload.administrations ?? []) {
      const medication = medications.get(dose.medication_id)
      const medicationId = medication ? medIds.get(medication.medication.id) : undefined
      if (!medication || medicationId == null) continue
      restorableDoses.add(dose.id)
      const timing = validateRecordTiming(dose.recorded_at)
      if (!timing.ok) throw new RestoreError(timing.error, 400)
      const amount = validateRecordDosage(dose.dosage)
      if (!amount.ok) throw new RestoreError(amount.error, 400)
      const unit = dosageUnit(dose.dosage_unit)
      const who = validateRecordAdministeredBy(dose.administered_by)
      if (!who.ok) throw new RestoreError(who.error, 400)
      const existing = personId == null ? undefined : db.prepare(
        `SELECT id FROM medication_records
         WHERE person_id = ? AND medication_id = ? AND recorded_at = ?
           AND ((dosage = ?) OR (dosage IS NULL AND ? IS NULL))
           AND ((dosage_unit = ?) OR (dosage_unit IS NULL AND ? IS NULL))
         LIMIT 1`,
      ).get(personId, medicationId, timing.recordedAt, amount.dosage, amount.dosage, unit, unit) as { id: number } | undefined
      if (existing) {
        administrationIds.set(dose.id, existing.id)
        duplicates.administrations += 1
      } else if (writing && personId != null) {
        const inserted = db.prepare(
          `INSERT INTO medication_records
            (person_id, medication_id, recorded_at, dosage, dosage_unit, comments, administered_by, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          personId, medicationId, timing.recordedAt, amount.dosage, unit, dose.comments, who.administeredBy,
          dose.created_by, dose.created_at,
        )
        const id = Number(inserted.lastInsertRowid)
        administrationIds.set(dose.id, id)
        auditLog(db, write.actorEmail, "CREATE", "medication_records", id, { person_id: personId, medication_id: medicationId })
        created.administrations += 1
      } else {
        created.administrations += 1
      }
    }

    // Dose-expectation outcomes point at administrations, so a second pass fills ids the first
    // pass could not see. Expectations inserted above stored null links; patch them when writing.
    linkDoseOutcomes(db, payload, assignmentIds, administrationIds, writing)

    restoreSlotOutcomes(db, payload, personId, assignmentIds, administrationIds, restorableAssignments, restorableDoses, writing, created, duplicates)

    restoreObservations(db, payload, personId, writing, write, created, duplicates, differences, warnings, skippedUnknown, neededTypes)
    restoreTests(db, payload, personId, writing, write, created, duplicates, differences, warnings, skippedUnknown, neededMetrics, fileJobs)
    restoreSymptoms(db, payload, personId, administrationIds, writing, write, created, duplicates)
    restoreGoals(db, payload, personId, personName, writing, write, created, duplicates, differences, warnings, skippedUnknown, neededTypes)
    restoreExpectations(db, payload, personId, payload.person.date_of_birth, writing, write, created, duplicates, differences, warnings, skippedUnknown, neededTypes)
  }

  if (writing) applyCatalogueFlags(db, activePersons.map(person => person.source.payload), neededTypes, neededMetrics)

  const personNames = new Map<number, string>()
  const personActions = new Map<number, PersonAction>()
  for (const person of persons) {
    const bundleId = person.source.payload.person.id
    personNames.set(bundleId, person.source.payload.person.name)
    personActions.set(bundleId, person.action)
  }

  let accounts: RestoreAccountsPlan = "not restored"
  let pending_invite_mails: PendingInviteMail[] | undefined
  let accounts_result: RestoreAccountsResult | undefined
  if (staged.manifest.scope === "household") {
    if (writing && write?.inviter && write.origin) {
      const applied = applyRestoreAccounts(
        db,
        staged.path,
        personIds,
        personActions,
        personNames,
        chosen.accounts ?? null,
        write.inviter,
        write.origin,
        write.actorEmail,
      )
      accounts_result = applied.result
      pending_invite_mails = applied.pendingMails
      accounts = applied.result.status === "skipped_preflight"
        ? { status: "skipped_preflight", message: applied.result.message ?? "", items: applied.result.items }
        : { status: "ready", items: applied.result.items }
    } else {
      accounts = planRestoreAccounts(db, staged.path, personNames, personActions, chosen.accounts ?? null)
    }
  }

  const createdAccountIdsByEmail = new Map<string, number>()
  for (const pending of pending_invite_mails ?? []) {
    createdAccountIdsByEmail.set(pending.mail.to.trim().toLowerCase(), pending.accountId)
  }
  const favourites = staged.manifest.scope === "household"
    ? restoreFavourites(
        db,
        staged.path,
        personIds,
        medIds,
        medications,
        personActions,
        accounts,
        createdAccountIdsByEmail,
        writing,
        write?.actorEmail ?? null,
      )
    : "not restored"
  const settings = staged.manifest.scope === "household"
    ? restoreSettings(db, staged.path, writing, write?.actorEmail ?? null)
    : "not restored"

  let user_settings: RestoreUserSettingsReport | "not restored" = "not restored"
  try {
    if (staged.manifest.scope === "household") {
      user_settings = restoreHouseholdUserSettings(
        db,
        staged.path,
        staged.manifest.format_version,
        personIds,
        personActions,
        accounts,
        createdAccountIdsByEmail,
        writing,
        write?.actorEmail ?? null,
      )
    } else {
      const signedIn = restorePersonSignIn(
        db,
        activePersons.map(person => person.source.payload),
        staged.manifest.format_version,
        personIds,
        personActions,
        chosen.person_sign_ins ?? null,
        writing,
        write?.actorEmail ?? null,
        write?.inviter,
        write?.origin,
      )
      user_settings = signedIn.report
      if (signedIn.pendingMails.length) {
        pending_invite_mails = [...(pending_invite_mails ?? []), ...signedIn.pendingMails]
      }
    }
  } catch (err) {
    if (err instanceof PersonSignInError) {
      throw new RestoreError(err.message, err.status, { sign_in_bundle_id: err.signInBundleId })
    }
    throw err
  }

  const skippedRecords = skippedUnknown.reduce((total, row) => total + row.count, 0)
  const skippedPersons = persons.filter(person => person.action === "skip").length
  const counts = {
    new: sumCounts(created),
    duplicate: sumCounts(duplicates),
    differing: differences.length + (settings === "not restored" ? 0 : settings.differences.length),
    skipped: skippedRecords + staged.manifest.skipped_files.length + skippedPersons,
  }
  if (writing) {
    auditLog(db, write.actorEmail, "RESTORE", "restore", null, {
      scope: staged.manifest.scope,
      format_version: staged.manifest.format_version,
      app_version: staged.manifest.app_version,
      counts,
      ...(staged.manifest.protected ? { protected: true } : {}),
      ...(user_settings === "not restored" ? {} : {
        user_settings: {
          timezone: user_settings.applied.timezone,
          hydration: user_settings.applied.hydration,
          notifications: user_settings.applied.notifications,
          kept: user_settings.kept,
          dropped_invalid: user_settings.dropped_invalid,
        },
      }),
    })
  }

  const personViews = persons.map(person => ({
    bundle_id: person.source.payload.person.id,
    name: person.source.payload.person.name,
    date_of_birth: person.source.payload.person.date_of_birth,
    suggested_action: person.action,
    target_id: person.action === "map" ? person.targetId : null,
  }))
  const medicationViews = [...medications.values()].map(medication => ({
    bundle_id: medication.medication.id,
    name: medication.medication.name,
    suggested_action: medication.action,
    target_id: medication.action === "map" ? medIds.get(medication.medication.id) ?? medication.targetId : null,
  }))

  return {
    id: staged.id,
    format_version: staged.manifest.format_version,
    scope: staged.manifest.scope,
    app_version: staged.manifest.app_version,
    exported_at: staged.manifest.exported_at,
    persons: personViews,
    medications: medicationViews,
    differences,
    warnings,
    counts,
    created,
    duplicates,
    skipped_unknown: skippedUnknown,
    mapped: {
      persons: persons.filter(person => person.action === "map").length,
      medications: [...medications.values()].filter(medication => medication.action === "map").length,
    },
    file_jobs: fileJobs,
    accounts,
    favourites,
    settings,
    user_settings,
    pending_invite_mails,
    accounts_result,
  }
}

const SLOT_RESULTS = new Set(["on_time", "early", "late", "missed", "given"])
const SLOT_MISSED_CAUSES = new Set(["timed_out", "not_given", "early_answer"])
const SLOT_YMD = /^\d{4}-\d{2}-\d{2}$/
const SLOT_SETTLED_AT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
const SLOT_HHMM = /^\d{2}:\d{2}$/

/**
 * Slot outcomes follow the assignment and the attached dose they were exported with. One lookup per row on the
 * unique (person_medication_id, local_ymd, slot_hhmm) index. A row whose assignment or dose was not restored is
 * left out; a row already on the instance, or whose existing duplicate dose already holds a different outcome, is a
 * duplicate and is never overwritten.
 */
function restoreSlotOutcomes(
  db: Database.Database,
  payload: PersonExportPayload,
  personId: number | null,
  assignmentIds: Map<number, number>,
  administrationIds: Map<number, number>,
  restorableAssignments: Set<number>,
  restorableDoses: Set<number>,
  writing: boolean,
  created: RestoreCounts,
  duplicates: RestoreCounts,
) {
  const find = db.prepare(
    "SELECT 1 AS ok FROM slot_outcomes WHERE person_medication_id = ? AND local_ymd = ? AND slot_hhmm = ?",
  )
  const holdsOutcome = db.prepare("SELECT 1 AS ok FROM slot_outcomes WHERE medication_record_id = ? LIMIT 1")
  const insert = db.prepare(
    `INSERT INTO slot_outcomes
       (person_medication_id, local_ymd, slot_hhmm, result, offset_minutes, missed_cause, medication_record_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
  )
  for (const row of payload.slot_outcomes ?? []) {
    const missed = row.result === "missed"
    const valid =
      SLOT_RESULTS.has(row.result) &&
      SLOT_YMD.test(row.local_ymd ?? "") && SLOT_HHMM.test(row.slot_hhmm ?? "") &&
      (row.offset_minutes == null || Number.isInteger(row.offset_minutes)) &&
      (missed
        ? row.missed_cause != null && SLOT_MISSED_CAUSES.has(row.missed_cause) && row.administration_id == null
        : row.missed_cause == null && row.administration_id != null)
    if (!valid) throw new RestoreError("A slot outcome in the export is not valid.", 400)
    if (!restorableAssignments.has(row.assignment_id)) continue
    if (row.administration_id != null && !restorableDoses.has(row.administration_id)) continue
    const assignmentId = assignmentIds.get(row.assignment_id)
    if (assignmentId != null && find.get(assignmentId, row.local_ymd, row.slot_hhmm)) {
      duplicates.slot_outcomes += 1
      continue
    }
    const recordId = row.administration_id == null ? null : (administrationIds.get(row.administration_id) ?? null)
    // A dose answers one slot. A duplicate dose already attached to a different outcome keeps it.
    if (recordId != null && holdsOutcome.get(recordId)) {
      duplicates.slot_outcomes += 1
      continue
    }
    if (writing && personId != null && assignmentId != null) {
      insert.run(assignmentId, row.local_ymd, row.slot_hhmm, row.result, row.offset_minutes ?? null, row.missed_cause ?? null, recordId,
        // Keep the original settle time, so an old Missed slot is not read as one that became Missed today.
        row.created_at && SLOT_SETTLED_AT.test(row.created_at) ? row.created_at : null)
    }
    created.slot_outcomes += 1
  }
}

function restoreDoseExpectations(
  db: Database.Database,
  assignment: AssignmentPayload,
  assignmentId: number | null,
  medicationName: string,
  writing: boolean,
  write: { actorEmail: string | null } | null,
  created: RestoreCounts,
  duplicates: RestoreCounts,
  differences: RestoreDifference[],
  _pendingOutcomes: Map<number, DoseExpectationPayload>,
) {
  for (const expectation of assignment.dose_expectations ?? []) {
    const existing = assignmentId == null ? undefined : db.prepare(
      `SELECT id FROM dose_expectations
       WHERE person_medication_id = ? AND slot_hhmm = ? AND start_date = ? AND end_date = ?
         AND ((weekdays = ?) OR (weekdays IS NULL AND ? IS NULL))
       LIMIT 1`,
    ).get(
      assignmentId, expectation.slot_hhmm, expectation.start_date, expectation.end_date,
      expectation.weekdays, expectation.weekdays,
    ) as { id: number } | undefined
    let expectationId = existing?.id ?? null
    if (existing) duplicates.dose_expectations += 1
    else {
      if (writing && assignmentId != null && write) {
        const inserted = db.prepare(
          `INSERT INTO dose_expectations
            (person_medication_id, slot_hhmm, start_date, end_date, weekdays, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          assignmentId, expectation.slot_hhmm, expectation.start_date, expectation.end_date,
          expectation.weekdays, expectation.created_by, expectation.created_at,
        )
        expectationId = Number(inserted.lastInsertRowid)
      }
      created.dose_expectations += 1
    }
    for (const day of expectation.exceptions ?? []) {
      const present = expectationId == null ? undefined : db.prepare(
        "SELECT 1 AS ok FROM dose_expectation_exceptions WHERE dose_expectation_id = ? AND local_ymd = ?",
      ).get(expectationId, day) as { ok: number } | undefined
      if (present) duplicates.dose_expectation_exceptions += 1
      else if (writing && expectationId != null) {
        db.prepare(
          "INSERT INTO dose_expectation_exceptions (dose_expectation_id, local_ymd) VALUES (?, ?)",
        ).run(expectationId, day)
        created.dose_expectation_exceptions += 1
      } else created.dose_expectation_exceptions += 1
    }
    for (const outcome of expectation.outcomes ?? []) {
      const present = expectationId == null ? undefined : db.prepare(
        "SELECT status FROM dose_expectation_outcomes WHERE dose_expectation_id = ? AND local_ymd = ?",
      ).get(expectationId, outcome.local_ymd) as { status: string } | undefined
      if (present) {
        duplicates.dose_expectation_outcomes += 1
        if (present.status !== outcome.status) {
          differences.push({
            kind: "dose_outcome", medication: medicationName, local_ymd: outcome.local_ymd, field: "status",
            existing: present.status, export: outcome.status,
          })
        }
      } else if (writing && expectationId != null) {
        db.prepare(
          `INSERT INTO dose_expectation_outcomes
            (dose_expectation_id, local_ymd, status, snoozed_until, slot_at, medication_record_id, resolved_by, resolved_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
        ).run(
          expectationId, outcome.local_ymd, outcome.status, outcome.snoozed_until, outcome.slot_at,
          outcome.resolved_by, outcome.resolved_at,
        )
        created.dose_expectation_outcomes += 1
      } else created.dose_expectation_outcomes += 1
    }
  }
}

/** Fills outcome → dose links once both sides have database ids. */
function linkDoseOutcomes(
  db: Database.Database,
  payload: PersonExportPayload,
  assignmentIds: Map<number, number>,
  administrationIds: Map<number, number>,
  writing: boolean,
) {
  if (!writing) return
  for (const assignment of payload.assignments ?? []) {
    const assignmentId = assignmentIds.get(assignment.id)
    if (assignmentId == null) continue
    for (const expectation of assignment.dose_expectations ?? []) {
      const row = db.prepare(
        `SELECT id FROM dose_expectations
         WHERE person_medication_id = ? AND slot_hhmm = ? AND start_date = ? AND end_date = ?
           AND ((weekdays = ?) OR (weekdays IS NULL AND ? IS NULL))
         LIMIT 1`,
      ).get(
        assignmentId, expectation.slot_hhmm, expectation.start_date, expectation.end_date,
        expectation.weekdays, expectation.weekdays,
      ) as { id: number } | undefined
      if (!row) continue
      for (const outcome of expectation.outcomes ?? []) {
        if (outcome.administration_id == null) continue
        const recordId = administrationIds.get(outcome.administration_id)
        if (recordId == null) continue
        db.prepare(
          `UPDATE dose_expectation_outcomes SET medication_record_id = ?
           WHERE dose_expectation_id = ? AND local_ymd = ? AND medication_record_id IS NULL`,
        ).run(recordId, row.id, outcome.local_ymd)
      }
    }
  }
}

function restoreObservations(
  db: Database.Database,
  payload: PersonExportPayload,
  personId: number | null,
  writing: boolean,
  write: { actorEmail: string | null } | null,
  created: RestoreCounts,
  duplicates: RestoreCounts,
  _differences: RestoreDifference[],
  warnings: RestoreWarning[],
  skippedUnknown: Assessment["skipped_unknown"],
  neededTypes: Set<string>,
) {
  const groups = new Map<number, ObservationPayload[]>()
  const singles: ObservationPayload[] = []
  for (const observation of payload.observations ?? []) {
    if (observation.group_id == null) singles.push(observation)
    else {
      const list = groups.get(observation.group_id) ?? []
      list.push(observation)
      groups.set(observation.group_id, list)
    }
  }

  const accept = (observation: ObservationPayload) => {
    const config = findObservationTypeConfig(db, observation.observation_type)
    if (!config) {
      noteUnknown(skippedUnknown, warnings, "observation_type", observation.observation_type)
      return null
    }
    if (typeof observation.unit !== "string" || observation.unit.trim() === "") {
      throw new RestoreError("unit is required", 400)
    }
    const timing = validateRecordTiming(observation.recorded_at)
    if (!timing.ok) throw new RestoreError(timing.error, 400)
    const validated = validateObservationWrite(db, {
      observation_type: observation.observation_type,
      value: observation.value,
    }, { requireActive: false })
    if (!validated.ok) throw new RestoreError(validated.error, 400)
    neededTypes.add(validated.observationType)
    return { config: validated.observationType, value: validated.value, recordedAt: timing.recordedAt, unit: observation.unit }
  }

  for (const observation of singles) {
    const accepted = accept(observation)
    if (!accepted) continue
    const existing = personId == null ? undefined : db.prepare(
      `SELECT id FROM observations
       WHERE person_id = ? AND observation_type = ? AND recorded_at = ? AND value = ? AND session_id IS NULL
       LIMIT 1`,
    ).get(personId, accepted.config, accepted.recordedAt, accepted.value) as { id: number } | undefined
    if (existing) duplicates.observations += 1
    else if (writing && personId != null && write) {
      const inserted = db.prepare(
        `INSERT INTO observations
          (person_id, observation_type, value, unit, value_label, recorded_at, comments, session_id, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      ).run(
        personId, accepted.config, accepted.value, accepted.unit, observation.value_label, accepted.recordedAt,
        observation.comments, observation.created_by, observation.created_at,
      )
      auditLog(db, write.actorEmail, "CREATE", "observations", Number(inserted.lastInsertRowid), {
        person_id: personId, observation_type: accepted.config,
      })
      created.observations += 1
    } else created.observations += 1
  }

  const existingSessions = personId == null ? [] : db.prepare(
    `SELECT session_id, observation_type, value, recorded_at FROM observations
     WHERE person_id = ? AND session_id IS NOT NULL`,
  ).all(personId) as { session_id: string; observation_type: string; value: number; recorded_at: string }[]
  const keyOf = (type: string, value: number, at: string) => `${type}\0${value}\0${at}`
  // One signature per existing session (its sorted member keys), so an incoming group is matched by a
  // lookup, not by rebuilding every existing session's keys for every group.
  const bySession = new Map<string, string[]>()
  for (const row of existingSessions) {
    const keys = bySession.get(row.session_id) ?? []
    keys.push(keyOf(row.observation_type, row.value, row.recorded_at))
    bySession.set(row.session_id, keys)
  }
  const sessionSignatures = new Set([...bySession.values()].map(keys => keys.sort().join("\u0001")))

  for (const members of groups.values()) {
    const accepted = members.flatMap(member => {
      const row = accept(member)
      return row ? [{ member, ...row }] : []
    })
    if (accepted.length === 0) continue
    const wanted = accepted.map(row => keyOf(row.config, row.value, row.recordedAt)).sort().join("\u0001")
    if (sessionSignatures.has(wanted)) {
      duplicates.observations += accepted.length
      continue
    }
    const sessionId = randomUUID()
    for (const row of accepted) {
      if (writing && personId != null && write) {
        const inserted = db.prepare(
          `INSERT INTO observations
            (person_id, observation_type, value, unit, value_label, recorded_at, comments, session_id, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          personId, row.config, row.value, row.unit, row.member.value_label, row.recordedAt,
          row.member.comments, sessionId, row.member.created_by, row.member.created_at,
        )
        auditLog(db, write.actorEmail, "CREATE", "observations", Number(inserted.lastInsertRowid), {
          person_id: personId, observation_type: row.config,
        })
      }
      created.observations += 1
    }
  }
}

function restoreTests(
  db: Database.Database,
  payload: PersonExportPayload,
  personId: number | null,
  writing: boolean,
  write: { actorEmail: string | null } | null,
  created: RestoreCounts,
  duplicates: RestoreCounts,
  differences: RestoreDifference[],
  warnings: RestoreWarning[],
  skippedUnknown: Assessment["skipped_unknown"],
  neededMetrics: Set<string>,
  fileJobs: FileJob[],
) {
  for (const result of payload.test_results ?? []) {
    const header = validateTestEventWrite({
      test_type: result.test_type, name: result.name, date: result.date,
      ordered_by: result.ordered_by, notes: result.notes,
    })
    if (!header.ok) throw new RestoreError(header.error, 400)
    // Events can share a name and date (a cleaned-up double entry leaves an empty one), so pick the
    // one that shares values with the export. An export event with no values matches the first.
    const exportedKeys = (result.values ?? []).map(value =>
      (findTestMetricConfig(db, value.metric_name)?.metric_name ?? value.metric_name).toLowerCase())
    const candidates = personId == null ? [] : db.prepare(
      `SELECT id FROM test_events
       WHERE person_id = ? AND name = ? AND date = ?
         AND ((ordered_by = ?) OR (ordered_by IS NULL AND ? IS NULL))
       ORDER BY id`,
    ).all(personId, header.name, header.date, header.orderedBy, header.orderedBy) as { id: number }[]
    let existing: { id: number } | undefined
    let bestScore = 0
    for (const candidate of candidates) {
      if (exportedKeys.length === 0) { existing = candidate; break }
      const have = new Set((db.prepare("SELECT metric_name FROM test_result_values WHERE test_event_id = ?")
        .all(candidate.id) as { metric_name: string }[]).map(row => row.metric_name.toLowerCase()))
      const score = exportedKeys.filter(key => have.has(key)).length
      if (score > bestScore) { bestScore = score; existing = candidate }
    }
    if (existing) {
      duplicates.test_results += 1
      const values = db.prepare(
        `SELECT metric_name, value_type, numeric_value, qualitative_value FROM test_result_values WHERE test_event_id = ?`,
      ).all(existing.id) as { metric_name: string; value_type: string; numeric_value: number | null; qualitative_value: string | null }[]
      for (const value of result.values ?? []) {
        // A name outside the catalogue is a free-text "Other" result, which the normal write path accepts.
        const config = findTestMetricConfig(db, value.metric_name)
        const metricName = config?.metric_name ?? value.metric_name
        if (config) neededMetrics.add(config.metric_name)
        const have = values.find(row => row.metric_name.toLowerCase() === metricName.toLowerCase())
        if (!have) {
          differences.push({
            kind: "test_result_value", test_name: header.name, metric: metricName, field: "value",
            existing: null, export: value.value_type === "numeric" ? value.numeric_value : value.qualitative_value,
          })
        } else if (value.value_type === "numeric" && have.numeric_value !== value.numeric_value) {
          differences.push({
            kind: "test_result_value", test_name: header.name, metric: metricName, field: "numeric_value",
            existing: have.numeric_value, export: value.numeric_value,
          })
        } else if (value.value_type === "qualitative" && have.qualitative_value !== value.qualitative_value) {
          differences.push({
            kind: "test_result_value", test_name: header.name, metric: metricName, field: "qualitative_value",
            existing: have.qualitative_value, export: value.qualitative_value,
          })
        } else duplicates.test_result_values += 1
      }
      continue
    }

    let attachmentUrl: string | null = null
    let job: FileJob | null = null
    if (result.report?.file) {
      const filename = `${randomUUID()}${fileExt(result.report.file, ".pdf")}`
      attachmentUrl = `/api/test-results/uploads/${filename}`
      job = { zipPath: result.report.file, bucket: "test-results", filename, bundlePath: result.report.file, url: attachmentUrl }
    }
    let eventId: number | null = null
    if (writing && personId != null && write) {
      const inserted = db.prepare(
        `INSERT INTO test_events (person_id, test_type, name, date, ordered_by, notes, attachment_url, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(personId, header.testType, header.name, header.date, header.orderedBy, header.notes, attachmentUrl, result.created_by, result.created_at)
      eventId = Number(inserted.lastInsertRowid)
      auditLog(db, write.actorEmail, "CREATE", "test_events", eventId, { person_id: personId })
      if (job) fileJobs.push(job)
    }
    created.test_results += 1
    for (const value of result.values ?? []) {
      const inCatalogue = findTestMetricConfig(db, value.metric_name) != null
      const validated = validateTestResultValueWrite(db, {
        metric_name: value.metric_name,
        other: !inCatalogue,
        value_type: value.value_type,
        numeric_value: value.numeric_value,
        qualitative_value: value.qualitative_value,
        unit: value.unit,
        reference_range: value.reference_range,
        flag: value.flag,
        limit_qualifier: value.limit_qualifier,
      }, { requireActive: false })
      if (!validated.ok) throw new RestoreError(validated.error, 400)
      if (inCatalogue) neededMetrics.add(validated.metricName)
      if (writing && eventId != null) {
        db.prepare(
          `INSERT INTO test_result_values
            (test_event_id, metric_name, value_type, numeric_value, qualitative_value, unit, reference_range, flag, limit_qualifier)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          eventId, validated.metricName, validated.valueType, validated.numericValue, validated.qualitativeValue,
          validated.unit, validated.referenceRange, validated.flag, validated.limitQualifier,
        )
      }
      created.test_result_values += 1
    }
  }
}

function restoreSymptoms(
  db: Database.Database,
  payload: PersonExportPayload,
  personId: number | null,
  administrationIds: Map<number, number>,
  writing: boolean,
  write: { actorEmail: string | null } | null,
  created: RestoreCounts,
  duplicates: RestoreCounts,
) {
  const symptomIds = new Map<number, number>()
  for (const symptom of payload.symptoms ?? []) {
    if (symptom.severity < 1 || symptom.severity > 5) throw new RestoreError("severity is out of range", 400)
    const existing = personId == null ? undefined : db.prepare(
      "SELECT id FROM symptom_events WHERE person_id = ? AND label = ? AND start_date = ? LIMIT 1",
    ).get(personId, symptom.label, symptom.start_date) as { id: number } | undefined
    if (existing) {
      symptomIds.set(symptom.id, existing.id)
      duplicates.symptoms += 1
    } else if (writing && personId != null && write) {
      const inserted = db.prepare(
        `INSERT INTO symptom_events
          (person_id, label, start_date, end_date, severity, is_resolved, resolved_at, notes, ongoing_confirmed_on, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        personId, symptom.label, symptom.start_date, symptom.end_date, symptom.severity, symptom.is_resolved ? 1 : 0,
        symptom.resolved_at, symptom.notes, symptom.ongoing_confirmed_on, symptom.created_by, symptom.created_at,
      )
      const id = Number(inserted.lastInsertRowid)
      symptomIds.set(symptom.id, id)
      auditLog(db, write.actorEmail, "CREATE", "symptom_events", id, { person_id: personId })
      created.symptoms += 1
    } else created.symptoms += 1
  }
  for (const link of payload.symptom_dose_links ?? []) {
    const symptomId = symptomIds.get(link.symptom_id)
    const recordId = administrationIds.get(link.administration_id)
    if (symptomId == null || recordId == null || personId == null) continue
    const existing = db.prepare(
      "SELECT 1 AS ok FROM symptom_dose_links WHERE symptom_event_id = ? AND medication_record_id = ?",
    ).get(symptomId, recordId) as { ok: number } | undefined
    if (existing) duplicates.symptom_dose_links += 1
    else if (writing && write) {
      db.prepare(
        `INSERT INTO symptom_dose_links (symptom_event_id, medication_record_id, person_id, created_by, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(symptomId, recordId, personId, link.created_by, link.created_at)
      const details = { person_id: personId, symptom_event_id: symptomId, medication_record_id: recordId }
      auditLog(db, write.actorEmail, "LINK", "symptom_events", symptomId, details)
      auditLog(db, write.actorEmail, "LINK", "medication_records", recordId, details)
      created.symptom_dose_links += 1
    } else created.symptom_dose_links += 1
  }
}

function restoreGoals(
  db: Database.Database,
  payload: PersonExportPayload,
  personId: number | null,
  personName: string,
  writing: boolean,
  write: { actorEmail: string | null } | null,
  created: RestoreCounts,
  duplicates: RestoreCounts,
  differences: RestoreDifference[],
  warnings: RestoreWarning[],
  skippedUnknown: Assessment["skipped_unknown"],
  neededTypes: Set<string>,
) {
  for (const goal of payload.observation_goals ?? []) {
    const config = findObservationTypeConfig(db, goal.observation_type)
    if (!config) {
      noteUnknown(skippedUnknown, warnings, "observation_type", goal.observation_type)
      continue
    }
    neededTypes.add(config.observation_type)
    const existing = personId == null ? undefined : db.prepare(
      `SELECT goal_type, target_value, target_max, unit, is_active, target_date
       FROM observation_goals WHERE person_id = ? AND observation_type = ? AND goal_type = ?`,
    ).get(personId, config.observation_type, goal.goal_type) as Record<string, unknown> | undefined
    if (existing) {
      duplicates.observation_goals += 1
      for (const field of ["target_value", "target_max", "unit", "is_active", "target_date"] as const) {
        if (!same(existing[field], goal[field])) {
          differences.push({
            kind: "observation_goal", person: personName, observation_type: config.observation_type, field,
            existing: existing[field], export: goal[field],
          })
        }
      }
    } else if (writing && personId != null && write) {
      db.prepare(
        `INSERT INTO observation_goals
          (person_id, observation_type, goal_type, target_value, target_max, unit, is_active, target_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(personId, config.observation_type, goal.goal_type, goal.target_value, goal.target_max, goal.unit, goal.is_active ? 1 : 0, goal.target_date)
      auditLog(db, write.actorEmail, "UPSERT", "observation_goals", null, {
        person_id: personId, observation_type: config.observation_type, goal_type: goal.goal_type,
      })
      created.observation_goals += 1
    } else created.observation_goals += 1
  }
}

function restoreExpectations(
  db: Database.Database,
  payload: PersonExportPayload,
  personId: number | null,
  dateOfBirth: string | null,
  writing: boolean,
  write: { actorEmail: string | null } | null,
  created: RestoreCounts,
  duplicates: RestoreCounts,
  differences: RestoreDifference[],
  warnings: RestoreWarning[],
  skippedUnknown: Assessment["skipped_unknown"],
  neededTypes: Set<string>,
) {
  const fields = [
    "cadence", "interval_days", "recurrence_day_of_month", "recurrence_month", "recurrence_day",
    "recurrence_use_birthday", "enabled", "due_time_hhmm", "tz",
  ] as const
  for (const expectation of payload.observation_expectations ?? []) {
    const config = findObservationTypeConfig(db, expectation.observation_type)
    if (!config) {
      noteUnknown(skippedUnknown, warnings, "observation_type", expectation.observation_type)
      continue
    }
    neededTypes.add(config.observation_type)
    const existing = personId == null ? undefined : db.prepare(
      `SELECT ${fields.join(", ")} FROM person_observation_expectations WHERE person_id = ? AND observation_type = ?`,
    ).get(personId, config.observation_type) as Record<string, unknown> | undefined
    if (existing) {
      duplicates.observation_expectations += 1
      for (const field of fields) {
        if (!same(existing[field], expectation[field])) {
          differences.push({
            kind: "observation_expectation", observation_type: config.observation_type, field,
            existing: existing[field], export: expectation[field],
          })
        }
      }
    } else {
      const validated = validateObservationExpectation(db, { ...expectation }, dateOfBirth)
      if (!validated.ok) throw new RestoreError(validated.error, 400)
      if (writing && personId != null && write) {
        const row = validated.row
        db.prepare(
          `INSERT INTO person_observation_expectations
            (person_id, observation_type, cadence, interval_days, recurrence_day_of_month, recurrence_month,
             recurrence_day, recurrence_use_birthday, enabled, due_time_hhmm, tz)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          personId, row.observation_type, row.cadence, row.interval_days, row.recurrence_day_of_month,
          row.recurrence_month, row.recurrence_day, row.recurrence_use_birthday, row.enabled, row.due_time_hhmm, row.tz,
        )
        auditLog(db, write.actorEmail, "CREATE", "person_observation_expectations", null, {
          person_id: personId, observation_type: row.observation_type,
        })
      }
      created.observation_expectations += 1
    }
  }
}

function applyCatalogueFlags(
  db: Database.Database,
  payloads: PersonExportPayload[],
  neededTypes: Set<string>,
  neededMetrics: Set<string>,
) {
  const typeFlags = new Map<string, number>()
  const metricFlags = new Map<string, number>()
  for (const payload of payloads) {
    for (const flag of payload.catalogues?.observation_types ?? []) typeFlags.set(flag.name.toLowerCase(), flag.is_active ? 1 : 0)
    for (const flag of payload.catalogues?.test_metrics ?? []) metricFlags.set(flag.name.toLowerCase(), flag.is_active ? 1 : 0)
  }
  const setType = db.prepare("UPDATE observation_type_config SET is_active = ? WHERE observation_type = ? COLLATE NOCASE")
  for (const name of neededTypes) {
    const flag = typeFlags.get(name.toLowerCase())
    if (flag === undefined) continue
    setType.run(flag, name)
  }
  const setMetric = db.prepare("UPDATE test_metric_config SET is_active = ? WHERE metric_name = ? COLLATE NOCASE")
  for (const name of neededMetrics) {
    const flag = metricFlags.get(name.toLowerCase())
    if (flag === undefined) continue
    setMetric.run(flag, name)
  }
}

export function buildPlan(
  db: Database.Database,
  staged: { id: string; path: string; manifest: ExportManifest },
): Assessment {
  return assessRestore(db, staged, null, null)
}

// Dose records are referenced by expectations; keep the type import used by callers that pass rows.
export type { AdministrationPayload, TestResultPayload }
