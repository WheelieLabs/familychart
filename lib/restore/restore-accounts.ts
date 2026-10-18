// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { isEntraOidRemoved } from "@/lib/account/entra-removed"
import { auditLog } from "@/lib/audit-log"
import { householdReportsForRole, isNoneRole } from "@/lib/account/none-role"
import { HOUSEHOLD_ROLE_OPTIONS } from "@/lib/account/account-role-labels"
import { isOutboundEmailConfigured } from "@/lib/email-send"
import type { HouseholdAccount, HouseholdExportPayload } from "@/lib/export/household-export"
import { HOUSEHOLD_PAYLOAD_ENTRY } from "@/lib/export/household-export"
import { createInvite, inviteInputProblem } from "@/lib/invite"
import { ENTRA_ALSO_NOTE } from "./messages"
import { isEmailTakenByAnyAccount } from "@/lib/local-account-gate"
import { isEntraProviderActive } from "@/lib/settings/auth-settings"
import type { AppUser } from "@/lib/session"
import type { PersonAction } from "./restore-engine"
import { ACCOUNTS_SKIPPED_NO_EMAIL } from "./messages"
import { HOUSEHOLD_MAX_BYTES, ZipFile } from "./zip-file"

export interface RestoreAccountChoice {
  bundle_id: number
  included: boolean
  /** Household Role chosen for an Account whose exported role is not authoritative. */
  role?: string
}

const CHOOSABLE_ROLES: readonly string[] = HOUSEHOLD_ROLE_OPTIONS.map(option => option.value)

export interface RestoreAccountPlanItem {
  bundle_id: number
  email: string
  role: string
  can_report: number
  is_active: number
  export_auth_method: string
  target_sign_in: "entra" | "local_invite"
  method_change_note: string | null
  person_name: string | null
  included: boolean
  skip_reason: "email_exists" | "person_skipped" | "excluded" | "preflight" | "entra_removed" | "invalid" | null
  note: string | null
  /** True when the role was not stored in the export (Entra assigns it from groups), so the Admin picks one. */
  role_needs_choice: boolean
}

export type RestoreAccountsPlan =
  | "not restored"
  | {
      status: "skipped_preflight"
      message: string
      items: RestoreAccountPlanItem[]
    }
  | {
      status: "ready"
      items: RestoreAccountPlanItem[]
    }

export interface RestoreAccountsResult {
  status: "skipped_preflight" | "applied" | "none"
  message?: string
  invites_created: number
  invites_skipped: number
  emails_sent: number
  emails_failed: number
  items: RestoreAccountPlanItem[]
}

export interface PendingInviteMail {
  accountId: number
  mail: { to: string; subject: string; text: string; html: string }
  /** Person-export Sign-in invites are counted apart from household Account invites. */
  kind?: "person_sign_in"
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

function targetSignIn(db: Database.Database): "entra" | "local_invite" {
  return isEntraProviderActive(db) ? "entra" : "local_invite"
}

function methodChangeNote(
  exportMethod: string,
  target: "entra" | "local_invite",
): string | null {
  const exportedEntra = exportMethod === "entra"
  const targetEntra = target === "entra"
  if (exportedEntra === targetEntra) return null
  if (targetEntra) {
    return ENTRA_ALSO_NOTE
  }
  return "This instance uses local email invites — they will set a password from the invite, not sign in with Entra."
}

/** Why an exported Account row cannot become an invite, in the interactive invite route's terms. */
function invalidAccountNote(account: HouseholdAccount, role: unknown): string | null {
  if (typeof account.email !== "string" || !account.email.trim()) return "no email address in the export"
  if (typeof role !== "string") return "role not recognised"
  const problem = inviteInputProblem({
    role,
    can_report: account.can_report,
    personAction: account.person_id != null ? "link" : "none",
  })
  if (problem === "invalid_role") return `role "${role}" is not a FamilyChart role`
  if (problem === "invalid_can_report") return "Household Reports setting is not valid"
  if (problem === "none_role_needs_person") {
    return "Role None needs a Personal-link, and this Account has none in the export"
  }
  return null
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

function personNameByBundleId(
  personNames: Map<number, string>,
  bundlePersonId: number | null,
): string | null {
  if (bundlePersonId == null) return null
  return personNames.get(bundlePersonId) ?? null
}

function exportedExternalId(account: HouseholdAccount): string | null {
  const value = (account as HouseholdAccount & { external_id?: unknown }).external_id
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function personActionByBundle(
  personActions: Map<number, PersonAction>,
  bundlePersonId: number | null,
): PersonAction | null {
  if (bundlePersonId == null) return null
  return personActions.get(bundlePersonId) ?? null
}

export function planRestoreAccounts(
  db: Database.Database,
  zipPath: string,
  personNames: Map<number, string>,
  personActions: Map<number, PersonAction>,
  choices: RestoreAccountChoice[] | null,
): RestoreAccountsPlan {
  const payload = readHouseholdPayload(zipPath)
  if (!payload?.accounts?.length) return "not restored"

  const emailConfigured = isOutboundEmailConfigured(db)
  const target = targetSignIn(db)
  const choiceById = new Map((choices ?? []).map(row => [row.bundle_id, row.included]))
  const roleById = new Map((choices ?? [])
    .filter(row => typeof row.role === "string" && CHOOSABLE_ROLES.includes(row.role))
    .map(row => [row.bundle_id, row.role as string]))

  const items = payload.accounts.map(account => {
    const email = typeof account.email === "string" ? normaliseEmail(account.email) : ""
    // Entra roles come from group membership at sign-in; the stored value is a placeholder.
    const role_needs_choice = account.auth_method === "entra" && target === "local_invite"
    const role = (role_needs_choice ? roleById.get(account.id) : undefined) ?? account.role
    const personAction = personActionByBundle(personActions, account.person_id)
    const personName = personNameByBundleId(personNames, account.person_id)
    let skip_reason: RestoreAccountPlanItem["skip_reason"] = null
    let note: string | null = null

    const externalId = exportedExternalId(account)
    const invalidNote = invalidAccountNote(account, role)
    if (invalidNote) {
      skip_reason = "invalid"
      note = `not restored: ${invalidNote}`
    } else if (account.auth_method === "entra" && externalId && isEntraOidRemoved(db, externalId)) {
      skip_reason = "entra_removed"
      note = "removed on this instance; allow them back first"
    } else if (!emailConfigured) {
      skip_reason = "preflight"
    } else if (isEmailTakenByAnyAccount(db, email)) {
      skip_reason = "email_exists"
    } else if (isNoneRole(role) && account.person_id != null && personAction === "skip") {
      skip_reason = "person_skipped"
      note = "Their Person was skipped, so this None-role Account was not invited."
    }
    if (skip_reason == null && !isNoneRole(role) && account.person_id != null) {
      note = note ?? "Household Role — arrives without a Personal-link; link under Management → People if needed."
    }

    const selectable = skip_reason == null
    const defaultIncluded = selectable
    let included = choiceById.has(account.id) ? choiceById.get(account.id)! : defaultIncluded
    if (!selectable) included = false
    else if (!included) skip_reason = "excluded"

    return {
      bundle_id: account.id,
      email,
      role,
      role_needs_choice,
      can_report: account.can_report,
      is_active: account.is_active,
      export_auth_method: account.auth_method,
      target_sign_in: target,
      method_change_note: methodChangeNote(account.auth_method, target),
      person_name: personName,
      included,
      skip_reason,
      note,
    }
  })

  if (!emailConfigured) {
    return { status: "skipped_preflight", message: ACCOUNTS_SKIPPED_NO_EMAIL, items }
  }
  return { status: "ready", items }
}

export function applyRestoreAccounts(
  db: Database.Database,
  zipPath: string,
  personIds: Map<number, number>,
  personActions: Map<number, PersonAction>,
  personNames: Map<number, string>,
  choices: RestoreAccountChoice[] | null,
  inviter: AppUser,
  origin: string,
  actorEmail: string | null,
): { result: RestoreAccountsResult; pendingMails: PendingInviteMail[] } {
  const plan = planRestoreAccounts(db, zipPath, personNames, personActions, choices)
  if (plan === "not restored") {
    return {
      result: { status: "none", invites_created: 0, invites_skipped: 0, emails_sent: 0, emails_failed: 0, items: [] },
      pendingMails: [],
    }
  }
  if (plan.status === "skipped_preflight") {
    return {
      result: {
        status: "skipped_preflight",
        message: plan.message,
        invites_created: 0,
        invites_skipped: plan.items.length,
        emails_sent: 0,
        emails_failed: 0,
        items: plan.items,
      },
      pendingMails: [],
    }
  }

  const payload = readHouseholdPayload(zipPath)
  const accountsById = new Map(payload?.accounts.map(row => [row.id, row]) ?? [])
  const pendingMails: PendingInviteMail[] = []
  let invites_created = 0
  let invites_skipped = 0
  const resultItems: RestoreAccountPlanItem[] = []

  for (const item of plan.items) {
    resultItems.push(item)
    if (!item.included || item.skip_reason != null) {
      invites_skipped += 1
      continue
    }
    const exported = accountsById.get(item.bundle_id)
    if (!exported) {
      invites_skipped += 1
      continue
    }

    let personAction: "link" | "create" | "none" = "none"
    let personId: number | undefined
    if (isNoneRole(item.role) && exported.person_id != null) {
      const action = personActions.get(exported.person_id)
      if (action === "skip") {
        invites_skipped += 1
        continue
      }
      const targetPersonId = personIds.get(exported.person_id)
      if (targetPersonId == null) {
        invites_skipped += 1
        continue
      }
      personAction = "link"
      personId = targetPersonId
    }

    const canReport = householdReportsForRole(item.role, exported.can_report) ?? 0
    const invite = createInvite(
      db,
      {
        email: item.email,
        role: item.role,
        personAction,
        personId,
        can_report: canReport,
        is_active: exported.is_active ? 1 : 0,
        allowInactivePersonLink: true,
      },
      { origin, inviter },
    )
    if (!invite.ok) {
      invites_skipped += 1
      continue
    }

    invites_created += 1
    auditLog(db, actorEmail, "CREATE", "accounts", invite.account.id, {
      email: item.email,
      role: item.role,
      invited: true,
      personAction,
      restored: true,
    })
    pendingMails.push({ accountId: invite.account.id, mail: invite.mail })
  }

  return {
    result: {
      status: "applied",
      invites_created,
      invites_skipped,
      emails_sent: 0,
      emails_failed: 0,
      items: resultItems,
    },
    pendingMails,
  }
}
