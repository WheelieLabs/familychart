// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "./logger"
import { getUserRole } from "./permissions"

/**
 * One structured line for an export, restore, Person erase or Account removal.
 * Counts and role only: never a name, email, date of birth, file name, health value or passphrase.
 */
export const DATA_EVENTS = [
  "person_export",
  "household_export",
  "restore_applied",
  "person_erased",
  "account_removed",
] as const

export type DataEvent = (typeof DATA_EVENTS)[number]

const OUTCOMES = new Set(["exported", "applied", "erased", "removed", "failed"])
const ROLES = new Set(["admin", "manager", "readwrite", "readonly", "self"])

export function actorRoleForLog(groups: string[]): string {
  return getUserRole(groups) ?? "self"
}

/** Section counts from a manifest, collapsed to persons, records and attachments. */
export function exportActivityCounts(sectionCounts: Record<string, number>): {
  persons: number
  records: number
  attachments: number
} {
  const countedAsPersons = new Set(["person", "persons", "people"])
  let records = 0
  for (const [key, value] of Object.entries(sectionCounts)) {
    if (countedAsPersons.has(key) || key === "attachments") continue
    if (typeof value === "number" && Number.isFinite(value)) records += value
  }
  return {
    persons: sectionCounts.persons ?? sectionCounts.person ?? sectionCounts.people ?? 0,
    records,
    attachments: sectionCounts.attachments ?? 0,
  }
}

export function logDataEvent(input: {
  event: DataEvent
  outcome: "exported" | "applied" | "erased" | "removed" | "failed"
  actorRole: string
  counts: Record<string, number>
  /** Set for an export or a restore of an export. Never pass the passphrase. */
  protected?: boolean
  fileFailures?: number
  accountOutcome?: "deactivated" | "kept" | "removed" | null
}): void {
  const counts: Record<string, number> = {}
  for (const [key, value] of Object.entries(input.counts)) {
    if (typeof value === "number" && Number.isFinite(value)) counts[key] = value
  }
  const payload: Record<string, unknown> = {
    event: input.event,
    actor_role: ROLES.has(input.actorRole) ? input.actorRole : "self",
    outcome: OUTCOMES.has(input.outcome) ? input.outcome : "failed",
    counts,
  }
  if (typeof input.protected === "boolean") payload.protected = input.protected
  if (typeof input.fileFailures === "number" && Number.isFinite(input.fileFailures)) {
    payload.file_failures = input.fileFailures
  }
  if (
    input.accountOutcome === "deactivated"
    || input.accountOutcome === "kept"
    || input.accountOutcome === "removed"
    || input.accountOutcome === null
  ) {
    payload.account_outcome = input.accountOutcome
  }
  const write = payload.outcome === "failed" ? logger.error : logger.info
  write(input.event, payload)
}
