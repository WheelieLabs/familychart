// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { logger } from "@/lib/logger"
import { getEntraRevalidationGap } from "@/lib/auth/entra-revalidation-gap"
import { entraRevalidationGapEmailHtml } from "@/lib/email-templates"
import { isOutboundEmailConfigured, sendOutboundEmail } from "@/lib/email-send"
import { publicOrigin } from "@/lib/reverse-proxy"
import { isoWeekKey, listAdminAccounts } from "@/lib/push/entra-revalidation-gap-push"

/** Instance-level `app_settings` row holding the ISO week last emailed; absent while there is no gap. */
const EMAILED_WEEK_KEY = "entra.revalidation_gap.emailed_week"

function readEmailedWeek(db: Database.Database): string | undefined {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(EMAILED_WEEK_KEY) as
    | { value: string }
    | undefined
  return row?.value
}

function clearEmailedWeek(db: Database.Database): void {
  db.prepare("DELETE FROM app_settings WHERE key = ?").run(EMAILED_WEEK_KEY)
}

function writeEmailedWeek(db: Database.Database, week: string, nowMs: number): void {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(EMAILED_WEEK_KEY, week, nowMs)
}

/** Admin Accounts with an email address and no push subscription, so each Admin gets one channel. */
function adminsWithoutPush(db: Database.Database): string[] {
  const subscribed = new Set(
    (db.prepare("SELECT DISTINCT user_uid FROM push_endpoints").all() as { user_uid: string }[]).map(r => r.user_uid),
  )
  return listAdminAccounts(db)
    .filter(a => a.email && !subscribed.has(a.uid))
    .map(a => a.email as string)
}

const SUBJECT = "FamilyChart: Entra group data is not being rechecked"

/** No personal data and no counts: it names the exposure and the two fixes, and links to the page. */
function buildEntraRevalidationGapEmail(pageUrl: string): { subject: string; text: string; html: string } {
  const paragraphs = [
    "FamilyChart isn't rechecking Microsoft Entra group data, so medication reminders may still reach someone who has left a group.",
    "To fix it, either configure Graph revalidation (grant User.Read.All and GroupMember.Read.All on the Entra app registration), or, if Graph is already configured, investigate the errors that are stopping group data arriving.",
    "You will get this email once a week until it is fixed.",
  ]
  return {
    subject: SUBJECT,
    text: `Entra group data is not being rechecked\n\n${paragraphs.join("\n\n")}\n\nSee what to do: ${pageUrl}`,
    html: entraRevalidationGapEmailHtml({ paragraphs, pageUrl }),
  }
}

async function sendEmailOnce(db: Database.Database, nowMs: number): Promise<void> {
  if (!getEntraRevalidationGap(db, nowMs)) {
    // Forget the week so the next onset emails immediately.
    clearEmailedWeek(db)
    return
  }
  if (!isOutboundEmailConfigured(db)) return

  const week = isoWeekKey(nowMs)
  if (readEmailedWeek(db) === week) return

  const to = adminsWithoutPush(db)
  if (to.length === 0) return

  // Cron has no request, so the origin comes from `NEXTAUTH_URL` via the same helper the invite emails use.
  const mail = buildEntraRevalidationGapEmail(`${publicOrigin(new Headers(), "")}/admin/entra-sessions`)
  let delivered = 0
  for (const address of to) {
    // `sendOutboundEmail` logs its own failures through the structured logger.
    const result = await sendOutboundEmail(db, { to: address, ...mail })
    if (result.ok) delivered += 1
  }
  // If nothing went out, leave the week unclaimed so the next run tries again.
  if (delivered > 0) writeEmailedWeek(db, week, nowMs)
}

/**
 * Email fallback for the weekly push, for Admins the push does not reach: sent when Entra access first
 * goes unchecked, then at most once per ISO week while it persists. Silent when outbound email is not
 * configured (the Entra Sessions banner says so instead). Forgets the week once the condition clears. A failed send is
 * logged and never throws, so it cannot block the push or the page.
 */
export async function emailAdminsOfEntraRevalidationGap(db: Database.Database, nowMs: number): Promise<void> {
  try {
    await sendEmailOnce(db, nowMs)
  } catch (err) {
    logger.error("entra_gap_email_failed", err instanceof Error ? err : { detail: String(err) })
  }
}
