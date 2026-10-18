// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { accountUidFromRow, formatLocalAccountUid } from "@/lib/account/account-uid"
import { NONE_ROLE, householdReportsForRole } from "@/lib/account/none-role"
import { VALID_ROLES } from "@/lib/account/account-roles"
import { isOutboundEmailConfigured } from "@/lib/email-send"
import type { HouseholdExportPayload } from "@/lib/export/household-export"
import { HOUSEHOLD_PAYLOAD_ENTRY } from "@/lib/export/household-export"
import {
  USER_SETTINGS_FORMAT_VERSION,
  applyDurableUserSettings,
  emptyDurableCounts,
  mergeDurableCounts,
  type DurableSettingsCounts,
  type PortableAccountSettings,
  type PortablePersonSettings,
} from "@/lib/export/portable-user-settings"
import { createInvite } from "@/lib/invite"
import { auditLog } from "@/lib/audit-log"
import { isEntraProviderActive } from "@/lib/settings/auth-settings"
import type { AppUser } from "@/lib/session"
import type { PersonExportPayload } from "@/lib/person/person-export-payload"
import {
  ENTRA_ALSO_NOTE,
  INVITE_CREATED_UNSENT,
  PERSONAL_SETTINGS_NOT_CARRIED,
  SIGN_IN_ALREADY_LINKED,
  SIGN_IN_PERSON_ALREADY_LINKED,
} from "./messages"
import type { PendingInviteMail, RestoreAccountsPlan } from "./restore-accounts"
import { ZipFile, HOUSEHOLD_MAX_BYTES } from "./zip-file"

/** Raised when one Person's Sign-in cannot be applied. The restore engine turns it into its own error. */
export class PersonSignInError extends Error {
  constructor(message: string, readonly status: number, readonly signInBundleId: number) {
    super(message)
    this.name = "PersonSignInError"
  }
}

export interface RestoreUserSettingsReport {
  applied: DurableSettingsCounts["applied"]
  kept: number
  dropped_invalid: number
  lines: string[]
}

export interface PersonSignInChoice {
  bundle_id: number
  email: string
  role: string
}

type PersonAction = "new" | "map" | "skip"

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

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function userSettingsLines(counts: DurableSettingsCounts, writing: boolean): string[] {
  const lines: string[] = []
  if (counts.applied.timezone) lines.push(writing ? "Applied timezone." : "Timezone will be applied.")
  if (counts.applied.hydration) lines.push(writing ? "Applied hydration pacing." : "Hydration pacing will be applied.")
  if (counts.applied.notifications) {
    lines.push(writing ? "Applied notification preferences." : "Notification preferences will be applied.")
  }
  if (counts.kept) {
    lines.push(`Kept ${plural(counts.kept, "per-user setting", "per-user settings")} this instance already has.`)
  }
  if (counts.dropped_invalid) {
    const noun = plural(counts.dropped_invalid, "invalid per-user setting", "invalid per-user settings")
    lines.push(writing ? `Dropped ${noun}.` : `${noun} will be dropped.`)
  }
  return lines
}

function reportFrom(counts: DurableSettingsCounts, writing: boolean, extra: string[] = []): RestoreUserSettingsReport {
  return {
    applied: counts.applied,
    kept: counts.kept,
    dropped_invalid: counts.dropped_invalid,
    lines: [...userSettingsLines(counts, writing), ...extra],
  }
}

function accountIncluded(plan: RestoreAccountsPlan, bundleId: number): boolean {
  if (plan === "not restored" || plan.status !== "ready") return false
  const item = plan.items.find(row => row.bundle_id === bundleId)
  return item != null && item.included && item.skip_reason == null
}

interface HouseholdSettingsTarget {
  /** The Account that receives the settings; null in a preview of an Account not yet invited. */
  uid: string | null
  /** True for an Account already on the target: settings fill only keys it has not set. */
  existing: boolean
}

/**
 * Where one exported Account's settings go: the Invite this restore created, or an Account
 * already on the target with the same email (additive; its credential and role stay as they
 * are). An Account the restore skips for any other reason receives nothing.
 */
function settingsTarget(
  db: Database.Database,
  payload: HouseholdExportPayload,
  bundleId: number,
  accounts: RestoreAccountsPlan,
  createdAccountIdsByEmail: Map<string, number>,
  writing: boolean,
): HouseholdSettingsTarget | null {
  const account = payload.accounts.find(row => row.id === bundleId)
  if (!account || typeof account.email !== "string") return null
  const email = account.email.trim().toLowerCase()
  if (accountIncluded(accounts, bundleId)) {
    const created = createdAccountIdsByEmail.get(email)
    if (writing) return created == null ? null : { uid: formatLocalAccountUid(created), existing: false }
    return { uid: null, existing: false }
  }
  if (accounts === "not restored") return null
  const item = accounts.items.find(row => row.bundle_id === bundleId)
  if (!item || (item.skip_reason !== "email_exists" && item.skip_reason !== "preflight")) return null
  const row = accountByEmail(db, email)
  const uid = row ? accountUidFromRow(row) : null
  return uid ? { uid, existing: true } : null
}

/**
 * Household restore. Settings are written onto each pending Invite's Account.
 * A skipped Account is skipped. Hydration is written only when its Person was restored
 * and this Account is that Person's Personal-link. Existing keys are kept.
 */
export function restoreHouseholdUserSettings(
  db: Database.Database,
  zipPath: string,
  formatVersion: number,
  personIds: Map<number, number>,
  personActions: Map<number, PersonAction>,
  accounts: RestoreAccountsPlan,
  createdAccountIdsByEmail: Map<string, number>,
  writing: boolean,
  actorEmail: string | null,
): RestoreUserSettingsReport | "not restored" {
  if (formatVersion < USER_SETTINGS_FORMAT_VERSION) return "not restored"
  const payload = readHouseholdPayload(zipPath)
  if (!payload || !Array.isArray(payload.user_settings)) return "not restored"

  const counts = emptyDurableCounts()
  for (const row of payload.user_settings) {
    const target = settingsTarget(db, payload, row.account_id, accounts, createdAccountIdsByEmail, writing)
    if (!target) continue
    mergeDurableCounts(counts, applyOneHouseholdRow(
      db, row, payload, personIds, personActions, target, writing, actorEmail,
    ))
  }
  return reportFrom(counts, writing)
}

function applyOneHouseholdRow(
  db: Database.Database,
  row: PortableAccountSettings,
  payload: HouseholdExportPayload,
  personIds: Map<number, number>,
  personActions: Map<number, PersonAction>,
  target: HouseholdSettingsTarget,
  writing: boolean,
  actorEmail: string | null,
): DurableSettingsCounts {
  const userUid = target.uid
  const account = payload.accounts.find(item => item.id === row.account_id)
  const hydrationPerson = row.hydration?.person_id
  const personRestored = hydrationPerson != null
    && personActions.get(hydrationPerson) !== "skip"
    && personActions.has(hydrationPerson)
    && (!writing || personIds.get(hydrationPerson) != null)
  // On an existing Account the pacing belongs to the Person it is already linked to, so it
  // arrives only when the exported Personal-link maps onto that same Person.
  const linkedHere = !target.existing || (
    userUid != null && personIds.get(hydrationPerson ?? -1) != null
    && db.prepare("SELECT 1 AS ok FROM people WHERE id = ? AND account_uid = ?")
      .get(personIds.get(hydrationPerson ?? -1), userUid) != null
  )
  const hydrationEligible = personRestored && account?.person_id === hydrationPerson && linkedHere
  const notifications = (row.notifications ?? []).flatMap(pref => {
    if (personActions.get(pref.person_id) === "skip" || !personActions.has(pref.person_id)) return []
    const personDbId = personIds.get(pref.person_id)
    if (writing && personDbId == null) return []
    return [{
      person_db_id: personDbId ?? pref.person_id,
      notify_prn: pref.notify_prn,
      notify_prescribed: pref.notify_prescribed,
      notify_overdue: pref.notify_overdue,
      notify_observations: pref.notify_observations,
      notify_hydration: pref.notify_hydration,
    }]
  })
  if (!writing) {
    return applyDurableUserSettings(db, userUid ?? "preview-skip", {
      timezone: row.timezone,
      hydration: hydrationEligible ? row.hydration : undefined,
      notifications: notifications.map(pref => ({ ...pref, person_db_id: -1 })),
    }, false, actorEmail)
  }
  if (!userUid) return emptyDurableCounts()
  return applyDurableUserSettings(db, userUid, {
    timezone: row.timezone,
    hydration: hydrationEligible ? row.hydration : undefined,
    notifications,
  }, true, actorEmail)
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

interface AccountRow {
  id: number
  email: string
  auth_method: "local" | "entra"
  external_id: string | null
}

function accountByEmail(db: Database.Database, email: string): AccountRow | undefined {
  return db.prepare(
    "SELECT id, email, auth_method, external_id FROM accounts WHERE email = ? COLLATE NOCASE",
  ).get(email) as AccountRow | undefined
}

function personIdForUid(db: Database.Database, uid: string): number | undefined {
  const row = db.prepare("SELECT id FROM people WHERE account_uid = ?").get(uid) as { id: number } | undefined
  return row?.id
}

function settingsForPerson(payload: PersonExportPayload): PortablePersonSettings | null {
  const section = payload.user_settings
  if (!section || typeof section !== "object") return null
  return section
}

/**
 * Person restore. The Sign-in field decides who holds this Person's settings.
 * Blank carries nothing. A new email becomes a pending Invite. An unlinked Account is linked.
 * An Account already linked to someone else is refused.
 */
export function restorePersonSignIn(
  db: Database.Database,
  payloads: PersonExportPayload[],
  formatVersion: number,
  personIds: Map<number, number>,
  personActions: Map<number, PersonAction>,
  choices: PersonSignInChoice[] | null,
  writing: boolean,
  actorEmail: string | null,
  inviter: AppUser | undefined,
  origin: string | undefined,
): { report: RestoreUserSettingsReport | "not restored"; pendingMails: PendingInviteMail[] } {
  if (formatVersion < USER_SETTINGS_FORMAT_VERSION) {
    return { report: "not restored", pendingMails: [] }
  }
  if (!writing) {
    return {
      report: { applied: emptyDurableCounts().applied, kept: 0, dropped_invalid: 0, lines: [] },
      pendingMails: [],
    }
  }

  const counts = emptyDurableCounts()
  const lines: string[] = []
  const pendingMails: PendingInviteMail[] = []
  const choiceById = new Map((choices ?? []).map(choice => [choice.bundle_id, choice]))

  for (const payload of payloads) {
    const bundleId = payload.person.id
    if (personActions.get(bundleId) === "skip") continue
    const targetPersonId = personIds.get(bundleId)
    if (targetPersonId == null) continue
    const choice = choiceById.get(bundleId)
    const email = normaliseEmail(choice?.email ?? "")
    const section = settingsForPerson(payload)

    if (email === "") {
      lines.push(PERSONAL_SETTINGS_NOT_CARRIED)
      continue
    }
    if (!isEmail(email)) {
      throw new PersonSignInError("Enter a valid email address.", 400, bundleId)
    }
    const role = (choice?.role ?? "").trim() || NONE_ROLE
    if (!VALID_ROLES.has(role)) {
      throw new PersonSignInError("Choose a Household Role.", 400, bundleId)
    }

    const existing = accountByEmail(db, email)
    let userUid: string
    if (!existing) {
      if (!inviter || !origin) throw new PersonSignInError("Restore could not create an invite.", 500, bundleId)
      const invite = createInvite(
        db,
        {
          email,
          role,
          personAction: "link",
          personId: targetPersonId,
          can_report: householdReportsForRole(role, 0) ?? 0,
          is_active: 1,
          allowInactivePersonLink: true,
        },
        { origin, inviter },
      )
      if (!invite.ok) {
        if (invite.reason === "person_already_linked") {
          throw new PersonSignInError(SIGN_IN_PERSON_ALREADY_LINKED, 400, bundleId)
        }
        throw new PersonSignInError("That email could not be invited.", 400, bundleId)
      }
      auditLog(db, actorEmail, "CREATE", "accounts", invite.account.id, {
        email,
        role,
        invited: true,
        personAction: "link",
        restored: true,
      })
      userUid = formatLocalAccountUid(invite.account.id)
      const entra = isEntraProviderActive(db)
      const emailConfigured = isOutboundEmailConfigured(db)
      lines.push("A pending invite was created.")
      if (!emailConfigured) lines.push(INVITE_CREATED_UNSENT)
      else pendingMails.push({ accountId: invite.account.id, mail: invite.mail, kind: "person_sign_in" })
      if (entra) lines.push(ENTRA_ALSO_NOTE)
    } else {
      userUid = accountUidFromRow(existing) ?? ""
      if (userUid === "") {
        throw new PersonSignInError(SIGN_IN_ALREADY_LINKED, 400, bundleId)
      }
      const linkedPersonId = personIdForUid(db, userUid)
      if (linkedPersonId != null && linkedPersonId !== targetPersonId) {
        throw new PersonSignInError(SIGN_IN_ALREADY_LINKED, 400, bundleId)
      }
      const current = db.prepare("SELECT account_uid FROM people WHERE id = ?").get(targetPersonId) as { account_uid: string | null }
      if (current.account_uid != null && current.account_uid !== userUid) {
        throw new PersonSignInError(SIGN_IN_PERSON_ALREADY_LINKED, 400, bundleId)
      }
      if (current.account_uid == null) {
        const updated = db.prepare(
          "UPDATE people SET account_uid = ? WHERE id = ? AND account_uid IS NULL",
        ).run(userUid, targetPersonId)
        if (updated.changes === 0) {
          throw new PersonSignInError(SIGN_IN_PERSON_ALREADY_LINKED, 400, bundleId)
        }
        auditLog(db, actorEmail, "UPDATE", "people", targetPersonId, { personal_link: true, restored: true })
      }
      lines.push("Linked the existing Account. No invite was sent.")
    }

    if (section) {
      const hydration = section.person_id === bundleId ? section.hydration : undefined
      const notifications = section.notifications && section.person_id === bundleId
        ? [{ person_db_id: targetPersonId, ...section.notifications }]
        : []
      mergeDurableCounts(counts, applyDurableUserSettings(db, userUid, {
        timezone: section.timezone,
        hydration,
        notifications,
      }, true, actorEmail))
    }
  }

  const report = reportFrom(counts, true, lines)
  return { report, pendingMails }
}
