// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { APP_VERSION } from "../version"
import { EXPORT_FORMAT_VERSION, MANIFEST_ENTRY, type ExportManifest, type SkippedFile } from "./export-manifest"
import type { ExportEntry } from "./export-zip-stream"
import { buildPersonExport } from "../person/person-export"
import { listUploadMeta } from "../uploads/store"
import { accountUidFromRow } from "../account/account-uid"
import { loadCatalogueFlags, type CatalogueFlag, type FrequencyRulePayload } from "../person/person-export-payload"
import { loadPortableHouseholdSettings, type PortableAccountSettings } from "./portable-user-settings"
import { APP_SETTINGS_REGISTRY } from "../settings/registry"
import { resolveSetting } from "../settings/resolver"

/** The shared household payload: the importer's source of truth for everything that is not one Person. */
export const HOUSEHOLD_PAYLOAD_ENTRY = "household.json"

export interface HouseholdGroup {
  id: number
  db_id: number
  name: string
  notes: string | null
  is_active: number
}

export interface HouseholdMedication {
  id: number
  db_id: number
  name: string
  default_dosage: number | null
  dosage_unit: string
  min_age_years: number | null
  max_age_years: number | null
  notes: string | null
  is_active: number
  /** Bundle-local group ids this medicine belongs to. */
  group_ids: number[]
  frequency_rules: FrequencyRulePayload[]
}

/** An Account as a credential-free invite: no password, MFA secret, session or invite token. */
export interface HouseholdAccount {
  id: number
  db_id: number
  email: string
  role: string
  can_report: number
  is_active: number
  /** How this Account signed in on the exporting instance. The target decides the method on restore. */
  auth_method: string
  /** Bundle-local Person id of the Personal-link, or null when there is none. */
  person_id: number | null
}

export interface HouseholdFavourite {
  account_id: number
  person_id: number
  action_kind: string
  medication_id: number | null
  observation_type: string | null
  default_value: string | null
  label: string | null
  sort_order: number
}

export interface HouseholdSetting {
  key: string
  value: string
}

export interface HouseholdExportPayload {
  medications: HouseholdMedication[]
  groups: HouseholdGroup[]
  accounts: HouseholdAccount[]
  favourites: HouseholdFavourite[]
  settings: HouseholdSetting[]
  catalogues: { observation_types: CatalogueFlag[]; test_metrics: CatalogueFlag[] }
  /** Durable per-user preferences, keyed by bundle-local Account and Person ids. */
  user_settings: PortableAccountSettings[]
}

class BundleIds {
  private readonly ids = new Map<number, number>()

  assign(key: number): number {
    let id = this.ids.get(key)
    if (id === undefined) {
      id = this.ids.size + 1
      this.ids.set(key, id)
    }
    return id
  }

  get(key: number): number | undefined {
    return this.ids.get(key)
  }
}

function loadHouseholdPayload(db: Database.Database): { payload: HouseholdExportPayload; personDbIds: number[] } {
  const groupIds = new BundleIds()
  const groups = (db
    .prepare("SELECT id, name, notes, is_active FROM medication_groups ORDER BY name COLLATE NOCASE ASC, id ASC")
    .all() as Array<Omit<HouseholdGroup, "db_id"> & { id: number }>).map(g => ({
      ...g,
      id: groupIds.assign(g.id),
      db_id: g.id,
    }))

  const members = db
    .prepare("SELECT medication_id, group_id FROM medication_group_members ORDER BY group_id ASC, medication_id ASC")
    .all() as Array<{ medication_id: number; group_id: number }>
  const groupsByMedication = new Map<number, number[]>()
  for (const member of members) {
    const groupId = groupIds.get(member.group_id)
    if (groupId === undefined) continue
    const list = groupsByMedication.get(member.medication_id) ?? []
    list.push(groupId)
    groupsByMedication.set(member.medication_id, list)
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
      `SELECT id, name, default_dosage, dosage_unit, min_age_years, max_age_years, notes, is_active
       FROM medications ORDER BY name COLLATE NOCASE ASC, id ASC`,
    )
    .all() as Array<Omit<HouseholdMedication, "db_id" | "group_ids" | "frequency_rules"> & { id: number }>).map(m => ({
      ...m,
      id: medicationIds.assign(m.id),
      db_id: m.id,
      group_ids: groupsByMedication.get(m.id) ?? [],
      frequency_rules: ruleStmt.all(m.id) as FrequencyRulePayload[],
    }))

  const personIds = new BundleIds()
  const people = db
    .prepare("SELECT id, account_uid FROM people ORDER BY sort_order ASC, id ASC")
    .all() as Array<{ id: number; account_uid: string | null }>
  const personDbIds: number[] = []
  const personIdByUid = new Map<string, number>()
  for (const person of people) {
    const bundleId = personIds.assign(person.id)
    personDbIds.push(person.id)
    if (person.account_uid) personIdByUid.set(person.account_uid, bundleId)
  }

  const accountIds = new BundleIds()
  const accountIdByUid = new Map<string, number>()
  const accounts = (db
    .prepare(
      `SELECT id, email, role, can_report, is_active, auth_method, external_id
       FROM accounts ORDER BY id ASC`,
    )
    .all() as Array<{
      id: number
      email: string
      role: string
      can_report: number
      is_active: number
      auth_method: "local" | "entra"
      external_id: string | null
    }>).map(row => {
      const uid = accountUidFromRow(row)
      const id = accountIds.assign(row.id)
      if (uid) accountIdByUid.set(uid, id)
      return {
        id,
        db_id: row.id,
        email: row.email,
        role: row.role,
        can_report: row.can_report,
        is_active: row.is_active,
        auth_method: row.auth_method,
        person_id: uid ? (personIdByUid.get(uid) ?? null) : null,
      }
    })

  const favourites = (db
    .prepare(
      `SELECT user_uid, person_id, action_kind, medication_id, observation_type, default_value, label, sort_order
       FROM favourites ORDER BY sort_order ASC, id ASC`,
    )
    .all() as Array<{
      user_uid: string
      person_id: number
      action_kind: string
      medication_id: number | null
      observation_type: string | null
      default_value: string | null
      label: string | null
      sort_order: number
    }>)
    .flatMap(row => {
      const accountId = accountIdByUid.get(row.user_uid)
      const personId = personIds.get(row.person_id)
      if (accountId === undefined || personId === undefined) return []
      const medicationId = row.medication_id === null ? null : medicationIds.get(row.medication_id)
      if (row.medication_id !== null && medicationId === undefined) return []
      return [{
        account_id: accountId,
        person_id: personId,
        action_kind: row.action_kind,
        medication_id: medicationId ?? null,
        observation_type: row.observation_type,
        default_value: row.default_value,
        label: row.label,
        sort_order: row.sort_order,
      }]
    })

  const settings = Object.values(APP_SETTINGS_REGISTRY)
    .filter(entry => !entry.secret && !entry.platformLocked)
    .map(entry => ({ key: entry.key, value: resolveSetting(db, entry.key).value }))

  const personBundleByDbId = new Map<number, number>()
  for (const person of people) {
    const bundleId = personIds.get(person.id)
    if (bundleId !== undefined) personBundleByDbId.set(person.id, bundleId)
  }

  return {
    payload: {
      medications,
      groups,
      accounts,
      favourites,
      settings,
      catalogues: loadCatalogueFlags(db),
      user_settings: loadPortableHouseholdSettings(db, accountIdByUid, personBundleByDbId),
    },
    personDbIds,
  }
}

function storedName(url: string | null): string | null {
  return url ? (url.split("/").pop() || null) : null
}

/** Bytes of the photos and reports a household export would include. Missing files count as nothing. */
export async function estimateHouseholdExportSize(db: Database.Database): Promise<{ bytes: number; reportBytes: number }> {
  const photos = new Set(
    (db.prepare("SELECT photo_url FROM people WHERE photo_url IS NOT NULL").all() as Array<{ photo_url: string }>)
      .map(row => storedName(row.photo_url))
      .filter((name): name is string => name !== null),
  )
  const reports = new Set(
    (db.prepare("SELECT attachment_url FROM test_events WHERE attachment_url IS NOT NULL").all() as Array<{ attachment_url: string }>)
      .map(row => storedName(row.attachment_url))
      .filter((name): name is string => name !== null),
  )
  const photoBytes = (await listUploadMeta("people"))
    .filter(meta => photos.has(meta.filename))
    .reduce((sum, meta) => sum + meta.sizeBytes, 0)
  const reportBytes = (await listUploadMeta("test-results"))
    .filter(meta => reports.has(meta.filename))
    .reduce((sum, meta) => sum + meta.sizeBytes, 0)
  return { bytes: photoBytes + reportBytes, reportBytes }
}

function sectionCounts(payload: HouseholdExportPayload): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const [section, value] of Object.entries(payload)) {
    if (Array.isArray(value)) counts[section] = value.length
  }
  return counts
}

export interface HouseholdExport {
  manifest: ExportManifest
  entries: ExportEntry[]
  personIds: number[]
}

/**
 * Builds a household export. Entry names never contain a Person's name. Files are read only
 * while the zip streams.
 */
export async function buildHouseholdExport(db: Database.Database, exportedAt: Date): Promise<HouseholdExport> {
  const { payload, personDbIds } = loadHouseholdPayload(db)
  const personEntries: ExportEntry[] = []
  const skipped_files: SkippedFile[] = []
  let attachments = 0
  let personRecords = 0
  for (let index = 0; index < personDbIds.length; index++) {
    const built = await buildPersonExport(db, personDbIds[index], exportedAt)
    if (!built) continue
    const folder = `people/${index + 1}`
    for (const entry of built.entries) {
      if (entry.name === MANIFEST_ENTRY) continue
      personEntries.push({ name: `${folder}/${entry.name}`, content: entry.content })
    }
    for (const file of built.manifest.skipped_files) {
      skipped_files.push({ path: `${folder}/${file.path}`, reason: file.reason })
    }
    attachments += built.manifest.counts.attachments ?? 0
    for (const [section, value] of Object.entries(built.manifest.counts)) {
      if (!["person", "persons", "people", "attachments"].includes(section)) personRecords += value
    }
  }

  const manifest: ExportManifest = {
    format_version: EXPORT_FORMAT_VERSION,
    scope: "household",
    app_version: APP_VERSION,
    exported_at: exportedAt.toISOString(),
    sections: [...Object.keys(payload), "people"],
    counts: { ...sectionCounts(payload), people: personDbIds.length, person_records: personRecords, attachments },
    skipped_files,
  }
  return {
    manifest,
    personIds: personDbIds,
    entries: [
      { name: MANIFEST_ENTRY, content: JSON.stringify(manifest, null, 2) },
      { name: HOUSEHOLD_PAYLOAD_ENTRY, content: JSON.stringify(payload, null, 2) },
      ...personEntries,
    ],
  }
}
