// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { loadEntraGraphConfig } from "@/lib/entra-graph-token"
import { isEntraProviderActive } from "@/lib/settings/auth-settings"
import { listAuthRevalidationStatuses } from "./auth-revalidation"

/** About two hourly poll cycles: long enough for a first poll (and one retry) to have landed. */
export const ENTRA_REVALIDATION_GAP_GRACE_MS = 2 * 60 * 60 * 1000

export interface EntraRevalidationGap {
  /** False when the app-only Graph credentials are absent, so nothing is ever rechecked. */
  graphConfigured: boolean
  /** Active Entra users still without group data after the grace period. */
  usersWithoutGroupData: number
}

/**
 * Whether Entra access is going unchecked: sign-in is active and either Graph revalidation is not
 * configured, or at least one active Entra user has had no group data for about two poll cycles.
 * Push delivery keeps working for those users (ADR-0009 fail-open), so this is what surfaces it.
 * Stateless, computed from the revalidation rows. Null when there is no gap.
 */
export function getEntraRevalidationGap(
  db: Database.Database,
  nowMs: number,
): EntraRevalidationGap | null {
  if (!isEntraProviderActive(db)) return null

  const graphConfigured = loadEntraGraphConfig() !== null
  const usersWithoutGroupData = listAuthRevalidationStatuses(db, "entra").filter(
    row =>
      row.status === "ok" &&
      row.groups == null &&
      nowMs - row.updatedAt > ENTRA_REVALIDATION_GAP_GRACE_MS,
  ).length

  if (graphConfigured && usersWithoutGroupData === 0) return null
  return { graphConfigured, usersWithoutGroupData }
}
