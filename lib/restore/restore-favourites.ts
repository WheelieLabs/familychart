// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { auditLog } from "@/lib/audit-log"
import { accountUidFromRow, formatLocalAccountUid } from "@/lib/account/account-uid"
import type { HouseholdExportPayload, HouseholdFavourite } from "@/lib/export/household-export"
import { HOUSEHOLD_PAYLOAD_ENTRY } from "@/lib/export/household-export"
import { validateFavouriteDefaultValue } from "@/lib/hydration/hydration-presets"
import type { MedicationPayload } from "@/lib/person/person-export-payload"
import type { PersonAction } from "./restore-engine"
import type { RestoreAccountsPlan } from "./restore-accounts"
import { ZipFile, HOUSEHOLD_MAX_BYTES } from "./zip-file"

export interface RestoreFavouritesReport {
  created: number
  duplicates: number
  not_restored: { reason: string; count: number }[]
  /** Favourites added to an Account already on the target, matched by email. */
  added_to_existing: { email: string; count: number }[]
}

interface EngineMedication {
  medication: MedicationPayload
}

function readHouseholdPayload(zipPath: string): HouseholdExportPayload | null {
  const zip = ZipFile.open(zipPath)
  try {
    const raw = zip.read(HOUSEHOLD_PAYLOAD_ENTRY, { maxBytes: HOUSEHOLD_MAX_BYTES })
    if (!raw) return null
    return JSON.parse(raw.toString("utf8")) as HouseholdExportPayload
  } finally {
    zip.close()
  }
}

function bump(rows: { reason: string; count: number }[], reason: string): void {
  const found = rows.find(row => row.reason === reason)
  if (found) found.count += 1
  else rows.push({ reason, count: 1 })
}

function accountIncluded(plan: RestoreAccountsPlan, email: string): boolean {
  if (plan === "not restored" || plan.status !== "ready") return false
  const item = plan.items.find(row => row.email === email)
  return item != null && item.included && item.skip_reason == null
}

/**
 * An Account already on the target that the export names by email. Its credential and role stay
 * as they are; Favourites arrive additively. A restore that skipped it for another reason
 * (unticked, Person skipped) leaves it alone.
 */
function matchesExistingAccount(plan: RestoreAccountsPlan, email: string): boolean {
  if (plan === "not restored") return true
  const item = plan.items.find(row => row.email === email)
  return item == null || item.skip_reason === "email_exists" || item.skip_reason === "preflight"
}

function uidForExistingEmail(db: Database.Database, email: string): string | null {
  const row = db.prepare(
    "SELECT id, auth_method, external_id FROM accounts WHERE email = ? COLLATE NOCASE",
  ).get(email) as { id: number; auth_method: "local" | "entra"; external_id: string | null } | undefined
  if (!row) return null
  return accountUidFromRow(row)
}

function favouriteExists(
  db: Database.Database,
  userUid: string,
  personId: number,
  actionKind: string,
  medicationId: number | null,
  observationType: string | null,
): boolean {
  const row = db.prepare(
    `SELECT 1 AS ok FROM favourites
     WHERE user_uid = ? AND person_id = ? AND action_kind = ?
       AND ((medication_id = ?) OR (medication_id IS NULL AND ? IS NULL))
       AND ((observation_type = ?) OR (observation_type IS NULL AND ? IS NULL))
     LIMIT 1`,
  ).get(userUid, personId, actionKind, medicationId, medicationId, observationType, observationType) as { ok: number } | undefined
  return row != null
}

/**
 * Favourites are written for Accounts this restore has just invited, and additively for an
 * Account already on the target with the same email (a Favourite it lacks is added, one it has
 * is counted as a duplicate, nothing is changed or removed). They point at the mapped Person
 * and medication. An Account that is neither on the target nor invited does not receive them.
 */
export function restoreFavourites(
  db: Database.Database,
  zipPath: string,
  personIds: Map<number, number>,
  medIds: Map<number, number>,
  medications: Map<number, EngineMedication>,
  personActions: Map<number, PersonAction>,
  accounts: RestoreAccountsPlan,
  createdAccountIdsByEmail: Map<string, number>,
  writing: boolean,
  actorEmail: string | null,
): RestoreFavouritesReport | "not restored" {
  const payload = readHouseholdPayload(zipPath)
  if (!payload) return "not restored"

  const created = { n: 0 }
  const duplicates = { n: 0 }
  const not_restored: { reason: string; count: number }[] = []
  const added = new Map<string, number>()

  for (const favourite of payload.favourites ?? []) {
    placeFavourite(
      db, favourite, payload, personIds, medIds, medications, personActions, accounts,
      createdAccountIdsByEmail, writing, actorEmail, created, duplicates, not_restored, added,
    )
  }

  return {
    created: created.n,
    duplicates: duplicates.n,
    not_restored,
    added_to_existing: [...added].map(([email, count]) => ({ email, count })),
  }
}

function placeFavourite(
  db: Database.Database,
  favourite: HouseholdFavourite,
  payload: HouseholdExportPayload,
  personIds: Map<number, number>,
  medIds: Map<number, number>,
  medications: Map<number, EngineMedication>,
  personActions: Map<number, PersonAction>,
  accounts: RestoreAccountsPlan,
  createdAccountIdsByEmail: Map<string, number>,
  writing: boolean,
  actorEmail: string | null,
  created: { n: number },
  duplicates: { n: number },
  not_restored: { reason: string; count: number }[],
  added: Map<string, number>,
): void {
  const account = payload.accounts.find(row => row.id === favourite.account_id)
  if (!account) {
    bump(not_restored, "account not restored")
    return
  }
  const email = account.email.trim().toLowerCase()
  const createdAccountId = createdAccountIdsByEmail.get(email)
  const willInvite = accountIncluded(accounts, email)
  const userUid = createdAccountId != null
    ? formatLocalAccountUid(createdAccountId)
    : uidForExistingEmail(db, email)
  const existingMatch = createdAccountId == null && !willInvite && userUid != null
    && matchesExistingAccount(accounts, email)
  if (createdAccountId == null && !willInvite && userUid == null) {
    bump(not_restored, "account not restored")
    return
  }

  const personAction = personActions.get(favourite.person_id)
  if (personAction == null || personAction === "skip") {
    bump(not_restored, "person skipped")
    return
  }
  const personId = personIds.get(favourite.person_id) ?? null
  if (writing && personId == null) {
    bump(not_restored, "person skipped")
    return
  }

  const target = resolveTarget(favourite, payload, medIds, medications)
  if (!target.ok) {
    bump(not_restored, target.reason)
    return
  }
  if (writing && target.medicationId == null && favourite.action_kind === "medication") {
    bump(not_restored, "medication not restored")
    return
  }

  const validated = validateFavouriteDefaultValue(
    favourite.action_kind,
    target.observationType,
    favourite.default_value,
  )
  if (!validated.ok) {
    bump(not_restored, "invalid favourite")
    return
  }

  const medicationId = favourite.action_kind === "medication" ? target.medicationId : null
  const observationType = favourite.action_kind === "observation" ? target.observationType : null

  if (userUid != null && personId != null && favouriteExists(
    db, userUid, personId, favourite.action_kind, medicationId, observationType,
  )) {
    duplicates.n += 1
    return
  }

  if (createdAccountId == null && !willInvite && !existingMatch) {
    bump(not_restored, "account not restored")
    return
  }

  if (writing && userUid != null && personId != null && medicationId !== undefined) {
    const inserted = db.prepare(
      `INSERT INTO favourites
        (user_uid, person_id, action_kind, medication_id, observation_type, default_value, label, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      userUid,
      personId,
      favourite.action_kind,
      medicationId,
      observationType,
      validated.value,
      favourite.label,
      favourite.sort_order,
    )
    auditLog(db, actorEmail, "CREATE", "favourites", Number(inserted.lastInsertRowid), {
      person_id: personId,
      action_kind: favourite.action_kind,
    })
  }
  created.n += 1
  if (existingMatch) added.set(email, (added.get(email) ?? 0) + 1)
}

function resolveTarget(
  favourite: HouseholdFavourite,
  payload: HouseholdExportPayload,
  medIds: Map<number, number>,
  medications: Map<number, EngineMedication>,
): { ok: true; medicationId: number | null; observationType: string | null } | { ok: false; reason: string } {
  if (favourite.action_kind === "observation") {
    if (!favourite.observation_type) return { ok: false, reason: "medication not restored" }
    return { ok: true, medicationId: null, observationType: favourite.observation_type }
  }
  if (favourite.action_kind !== "medication") return { ok: false, reason: "medication not restored" }
  const householdMed = payload.medications.find(row => row.id === favourite.medication_id)
  if (!householdMed) return { ok: false, reason: "medication not restored" }
  const engine = [...medications.values()].find(
    row => row.medication.name.toLowerCase() === householdMed.name.toLowerCase(),
  )
  if (!engine) return { ok: false, reason: "medication not restored" }
  const mapped = medIds.get(engine.medication.id)
  if (mapped == null || mapped < 0) return { ok: true, medicationId: null, observationType: null }
  return { ok: true, medicationId: mapped, observationType: null }
}
