// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@/lib/logger"

import type Database from "better-sqlite3-multiple-ciphers"
import {
  getAppOnlyGraphToken,
  loadEntraGraphConfig,
  type EntraGraphConfig,
} from "@/lib/entra-graph-token"

export type AuthRevalidationProvider = "entra"
export type AuthRevalidationStatusValue = "ok" | "revoked"

export interface AuthRevalidationRow {
  provider: string
  externalId: string
  status: AuthRevalidationStatusValue
  lastCheckedAt: number | null
  groups: string[] | null
  email: string | null
  displayName: string | null
  updatedAt: number
}

interface AuthRevalidationDbRow {
  provider: string
  external_id: string
  status: string
  last_checked_at: number | null
  groups_json: string | null
  email: string | null
  display_name: string | null
  updated_at: number
}

function fromDbRow(row: AuthRevalidationDbRow): AuthRevalidationRow {
  return {
    provider: row.provider,
    externalId: row.external_id,
    status: row.status === "revoked" ? "revoked" : "ok",
    lastCheckedAt: row.last_checked_at,
    groups: row.groups_json ? (JSON.parse(row.groups_json) as string[]) : null,
    email: row.email,
    displayName: row.display_name,
    updatedAt: row.updated_at,
  }
}

export function getAuthRevalidationStatus(
  db: Database.Database,
  provider: AuthRevalidationProvider,
  externalId: string,
): AuthRevalidationRow | null {
  const row = db
    .prepare("SELECT * FROM auth_revalidation_status WHERE provider = ? AND external_id = ?")
    .get(provider, externalId) as AuthRevalidationDbRow | undefined
  return row ? fromDbRow(row) : null
}

export function listAuthRevalidationStatuses(
  db: Database.Database,
  provider: AuthRevalidationProvider,
): AuthRevalidationRow[] {
  const rows = db
    .prepare("SELECT * FROM auth_revalidation_status WHERE provider = ? ORDER BY updated_at DESC")
    .all(provider) as AuthRevalidationDbRow[]
  return rows.map(fromDbRow)
}

/**
 * Ensures a tracking row exists for a provider/external_id pair — called from the
 * `jwt` callback on sign-in so the hourly Entra live-revocation poller has something to revalidate.
 * Idempotent; refreshes email/displayName on each call (harmless, keeps them current).
 */
export function ensureAuthRevalidationRow(
  db: Database.Database,
  provider: AuthRevalidationProvider,
  externalId: string,
  identity: { email?: string | null; displayName?: string | null },
): void {
  db.prepare(
    `INSERT INTO auth_revalidation_status (provider, external_id, status, last_checked_at, groups_json, email, display_name, updated_at)
     VALUES (?, ?, 'ok', NULL, NULL, ?, ?, ?)
     ON CONFLICT(provider, external_id) DO UPDATE SET
       email = excluded.email,
       display_name = excluded.display_name,
       updated_at = excluded.updated_at`,
  ).run(provider, externalId, identity.email ?? null, identity.displayName ?? null, Date.now())
}

function writeAuthRevalidationResult(
  db: Database.Database,
  provider: AuthRevalidationProvider,
  externalId: string,
  fields: { status: AuthRevalidationStatusValue; groups?: string[] | null },
): void {
  db.prepare(
    `UPDATE auth_revalidation_status
     SET status = ?, last_checked_at = ?, groups_json = ?, updated_at = ?
     WHERE provider = ? AND external_id = ?`,
  ).run(
    fields.status,
    Date.now(),
    fields.groups !== undefined ? JSON.stringify(fields.groups) : null,
    Date.now(),
    provider,
    externalId,
  )
}

/**
 * Admin-triggered instant revoke — zero Graph dependency, takes effect on the
 * user's next request via {@link evaluateEntraSessionValidity}.
 */
export function revokeAuthRevalidation(
  db: Database.Database,
  provider: AuthRevalidationProvider,
  externalId: string,
): boolean {
  const info = db
    .prepare(
      `UPDATE auth_revalidation_status SET status = 'revoked', updated_at = ?
       WHERE provider = ? AND external_id = ?`,
    )
    .run(Date.now(), provider, externalId)
  return info.changes > 0
}

/**
 * Soft-refresh JWT group claims from a successful poll cache, so an IdP-side group
 * demotion is reflected without waiting for a full re-login.
 * Returns `polledGroups` when non-null (authoritative after first Graph poll).
 * When `polledGroups` is null (row not yet polled — see `ensureAuthRevalidationRow`),
 * keeps `tokenGroups` so login-time IdP claims are not wiped before the first poll.
 */
export function resolveEntraJwtGroups(
  tokenGroups: string[] | undefined,
  polledGroups: string[] | null,
): string[] {
  if (polledGroups == null) return tokenGroups ?? []
  return polledGroups
}

/**
 * Per-request session-validity check for the `jwt` callback, part of Entra live
 * revocation. Pure function —
 * no DB/network access — so it's unit-testable independent of next-auth.
 *
 * - `revoked` status (admin-triggered or Graph-detected) invalidates immediately.
 * - Otherwise, `ENTRA_SESSION_MAX_AGE_MINUTES` is the fail-safe bound: time since the
 *   last *successful revalidation* (or sign-in, if never yet revalidated) must not
 *   exceed it, forcing interactive re-login (which re-reads group claims) if it does.
 */
export function evaluateEntraSessionValidity(params: {
  status: AuthRevalidationStatusValue | null
  lastCheckedAt: number | null
  authAt: number | null
  maxAgeMs: number
  nowMs: number
}): boolean {
  const { status, lastCheckedAt, authAt, maxAgeMs, nowMs } = params
  if (status === "revoked") return false
  const staleSinceMs = lastCheckedAt ?? authAt
  if (staleSinceMs == null) return false
  return nowMs - staleSinceMs <= maxAgeMs
}

const POLL_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
const LAST_POLL_KEY = "entra_revalidation_last_poll_at"

/** Self-gate so the poller only actually runs once per hour despite ticking every 5 min. */
export function shouldPollAuthRevalidation(db: Database.Database, nowMs: number): boolean {
  const row = db
    .prepare("SELECT value FROM system_config WHERE key = ?")
    .get(LAST_POLL_KEY) as { value: string } | undefined
  if (!row) return true
  const lastPollAt = parseInt(row.value, 10)
  if (!Number.isFinite(lastPollAt)) return true
  return nowMs - lastPollAt > POLL_INTERVAL_MS
}

function markAuthRevalidationPolled(db: Database.Database, nowMs: number): void {
  db.prepare(
    `INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  ).run(LAST_POLL_KEY, String(nowMs))
}

interface GraphUserCheckResult {
  /** null = user not found / deleted (treated as revoked). */
  accountEnabled: boolean | null
  groupIds: string[]
}

/** Requires app-only Graph permissions `User.Read.All` + `GroupMember.Read.All`. */
async function checkGraphUser(cfg: EntraGraphConfig, oid: string): Promise<GraphUserCheckResult> {
  const token = await getAppOnlyGraphToken(cfg)
  const headers = { Authorization: `Bearer ${token}` }

  const userRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(oid)}?$select=accountEnabled`,
    { headers },
  )
  if (userRes.status === 404) {
    return { accountEnabled: null, groupIds: [] }
  }
  if (!userRes.ok) {
    throw new Error(`Graph user lookup failed (${userRes.status}): ${await userRes.text()}`)
  }
  const user = (await userRes.json()) as { accountEnabled?: boolean }

  const groupsRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(oid)}/memberOf?$select=id`,
    { headers },
  )
  if (!groupsRes.ok) {
    throw new Error(`Graph group lookup failed (${groupsRes.status}): ${await groupsRes.text()}`)
  }
  const groups = (await groupsRes.json()) as { value?: { id: string }[] }

  return {
    accountEnabled: user.accountEnabled ?? true,
    groupIds: (groups.value ?? []).map(g => g.id),
  }
}

export interface PollResult {
  checked: number
  errors: string[]
  /** Entra OIDs marked revoked this cycle — callers prune their push subscriptions. */
  revokedExternalIds: string[]
}

/**
 * Hourly Entra revalidation poll. Fail-open: a per-user Graph error leaves that
 * user's row untouched (retried next successful poll cycle) rather than affecting their
 * live session. Runs only when {@link shouldPollAuthRevalidation} allows it, and always
 * marks the poll cycle as attempted (so a systemic outage doesn't wedge the hourly gate
 * open forever waiting for one users's error) — see `markAuthRevalidationPolled`.
 */
export async function pollEntraRevalidation(db: Database.Database): Promise<PollResult> {
  const result: PollResult = { checked: 0, errors: [], revokedExternalIds: [] }
  const nowMs = Date.now()
  if (!shouldPollAuthRevalidation(db, nowMs)) return result

  const cfg = loadEntraGraphConfig()
  if (!cfg) {
    // Entra self-hosters who haven't enabled this feature (no Graph permission
    // grant/creds beyond sign-in) — nothing to poll; still mark attempted so we
    // don't tight-loop the gate check every 5 min forever.
    markAuthRevalidationPolled(db, nowMs)
    return result
  }

  const rows = listAuthRevalidationStatuses(db, "entra").filter(r => r.status === "ok")
  for (const row of rows) {
    try {
      const check = await checkGraphUser(cfg, row.externalId)
      if (check.accountEnabled === null || check.accountEnabled === false) {
        writeAuthRevalidationResult(db, "entra", row.externalId, { status: "revoked", groups: check.groupIds })
        result.revokedExternalIds.push(row.externalId)
      } else {
        // Intentional: may restore `ok` after an admin instant-revoke when Entra still
        // shows the account enabled. Admin revoke bridges poll lag; Entra remains SoT.
        // See ADR-0009 "Admin revoke vs Graph poll".
        writeAuthRevalidationResult(db, "entra", row.externalId, { status: "ok", groups: check.groupIds })
      }
      result.checked++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`[auth-revalidation] Graph check failed for entra:${row.externalId}:`, err)
      result.errors.push(`entra:${row.externalId}: ${msg}`)
    }
  }

  markAuthRevalidationPolled(db, nowMs)
  return result
}
