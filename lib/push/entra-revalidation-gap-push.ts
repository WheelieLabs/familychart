// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { getEntraRevalidationGap } from "@/lib/auth/entra-revalidation-gap"
import { listAuthRevalidationStatuses } from "@/lib/auth/auth-revalidation"
import { buildEntraRevalidationGapPayload } from "@/lib/cron/cron-notification-payloads"
import { isAdmin } from "@/lib/permissions"
import { markSent, sendAndLogPush, type PushEndpointWithUser } from "@/lib/push"

export interface AdminAccount {
  /** Session identity: `local:<id>` or the Entra object id; the key of `push_endpoints.user_uid`. */
  uid: string
  email: string | null
}

/** `YYYY-Www` for the ISO week containing `nowMs` (weeks start Monday; UTC). */
export function isoWeekKey(nowMs: number): string {
  const d = new Date(nowMs)
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7))
  const year = thursday.getUTCFullYear()
  const dayOfYear = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / 86_400_000)
  const week = Math.floor(dayOfYear / 7) + 1
  return `${year}-W${String(week).padStart(2, "0")}`
}

/**
 * Admin accounts: active local admins, plus Entra users whose polled groups make them an admin. An
 * Entra admin with no group data cannot be recognised, which is the very gap being reported, so the
 * banner remains the fallback for them.
 */
export function listAdminAccounts(db: Database.Database): AdminAccount[] {
  const admins: AdminAccount[] = (
    db
      .prepare(
        "SELECT id, email FROM accounts WHERE auth_method = 'local' AND role = 'admin' AND is_active = 1 AND status = 'active'",
      )
      .all() as { id: number; email: string }[]
  ).map(r => ({ uid: `local:${r.id}`, email: r.email }))
  for (const row of listAuthRevalidationStatuses(db, "entra")) {
    if (row.status === "ok" && row.groups != null && isAdmin(row.groups)) {
      admins.push({ uid: row.externalId, email: row.email })
    }
  }
  return admins
}

function adminSubscriptions(db: Database.Database): PushEndpointWithUser[] {
  const uids = listAdminAccounts(db).map(a => a.uid)
  if (uids.length === 0) return []
  return db
    .prepare(
      `SELECT endpoint, p256dh, web_push_auth, user_uid FROM push_endpoints
       WHERE user_uid IN (${uids.map(() => "?").join(", ")})`,
    )
    .all(...uids) as PushEndpointWithUser[]
}

/**
 * Tells subscribed Admins that Entra access is going unchecked: when the gap first appears, then at
 * most once per ISO week while it persists (`push_log` key per week). Silent when there is no gap, so
 * it resolves on its own once Graph data flows. Unsubscribing from push stops it; it is not written
 * to the notification history, which is bound to a Person.
 */
export async function notifyAdminsOfEntraRevalidationGap(
  db: Database.Database,
  nowMs: number,
): Promise<{ sent: number; errors: string[] }> {
  if (!getEntraRevalidationGap(db, nowMs)) return { sent: 0, errors: [] }

  const refKey = `entra-revalidation-gap:${isoWeekKey(nowMs)}`
  if (!markSent(db, refKey)) return { sent: 0, errors: [] }

  const endpoints = adminSubscriptions(db)
  if (endpoints.length === 0) {
    // Nobody to tell yet: release the claim so an Admin who subscribes later still hears this week.
    db.prepare("DELETE FROM push_log WHERE ref_key = ?").run(refKey)
    return { sent: 0, errors: [] }
  }
  return sendAndLogPush(db, endpoints, buildEntraRevalidationGapPayload())
}
