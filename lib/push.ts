// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@/lib/logger"

import webpush from "web-push"
import type Database from "better-sqlite3-multiple-ciphers"
import type { PushEndpoint } from "./domain-types"
import {
  createPushHttpsAgent,
  PUSH_REQUEST_TIMEOUT_MS,
} from "@/lib/push/push-endpoint-validation"
import { pushSubscriberStillAuthorised } from "@/lib/push/push-subscriptions"
import { getVapidConfig } from "@/lib/vapid-config"

export type NotifyField =
  | "notify_prn"
  | "notify_prescribed"
  | "notify_overdue"
  | "notify_observations"
  | "notify_hydration"

export type PushEndpointWithUser = Pick<PushEndpoint, "endpoint" | "p256dh" | "web_push_auth"> & {
  user_uid: string
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  icon?: string
  badge?: string
  tag?: string
  requireInteraction?: boolean
  /** Notification action buttons (handled in public/sw-push.js). */
  actions?: { action: string; title: string }[]
  data?: Record<string, unknown>
}

export interface NotificationLogRow {
  id: number
  recipient_user_id: string
  person_id: number
  type: string
  title: string
  body: string
  sent_at: string
  person_name: string
  person_color: string
}

export interface NotificationLogCursor {
  ts: string
  id: number
}

const pushAgent = createPushHttpsAgent()

const NOTIFY_FIELD_COLUMNS: Record<NotifyField, string> = {
  notify_prn: "notify_prn",
  notify_prescribed: "notify_prescribed",
  notify_overdue: "notify_overdue",
  notify_observations: "notify_observations",
  notify_hydration: "notify_hydration",
}

export function notifyFieldToLogType(field: NotifyField): string {
  switch (field) {
    case "notify_prn":
      return "prn"
    case "notify_prescribed":
      return "prescribed"
    case "notify_overdue":
      return "overdue"
    case "notify_observations":
      return "observation"
    case "notify_hydration":
      return "hydration"
  }
}

function configurePush(db: Database.Database) {
  const cfg = getVapidConfig(db)
  if (!cfg) {
    throw new Error("VAPID is not configured")
  }
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey)
}

function pushStatusCode(err: unknown): number | undefined {
  if (err && typeof err === "object" && "statusCode" in err) {
    const code = (err as { statusCode?: unknown }).statusCode
    return typeof code === "number" ? code : undefined
  }
  return undefined
}

function pruneExpiredEndpoint(db: Database.Database, endpoint: string, statusCode: number): void {
  const result = db.prepare("DELETE FROM push_endpoints WHERE endpoint = ?").run(endpoint)
  const hint = endpoint.length > 48 ? `${endpoint.slice(0, 48)}…` : endpoint
  logger.info(
    `[push] pruned expired endpoint (${statusCode}, removed=${result.changes}): ${hint}`,
  )
}

function writeNotificationLogRows(
  db: Database.Database,
  endpoints: { user_uid: string }[],
  log: { personId: number; type: string },
  payload: PushPayload,
): void {
  const recipients = [...new Set(endpoints.map(ep => ep.user_uid.trim()).filter(Boolean))]
  if (recipients.length === 0) return
  const insert = db.prepare(
    `INSERT INTO notification_log (recipient_user_id, person_id, type, title, body)
     VALUES (?, ?, ?, ?, ?)`,
  )
  const writeMany = db.transaction(() => {
    for (const userUid of recipients) {
      insert.run(userUid, log.personId, log.type, payload.title, payload.body)
    }
  })
  writeMany()
}

/**
 * Send web-push to endpoints. When `log` is set, writes one `notification_log`
 * row per distinct `user_uid` (not per device). Logging failures never affect delivery.
 */
export async function sendAndLogPush(
  db: Database.Database,
  endpoints: (Pick<PushEndpoint, "endpoint" | "p256dh" | "web_push_auth"> & {
    user_uid?: string
  })[],
  payload: PushPayload,
  log?: { personId: number; type: string },
): Promise<{ sent: number; errors: string[] }> {
  if (endpoints.length === 0) return { sent: 0, errors: [] }
  configurePush(db)
  const body = JSON.stringify(payload)
  let sent = 0
  const errors: string[] = []
  for (const ep of endpoints) {
    try {
      await webpush.sendNotification(
        { endpoint: ep.endpoint, keys: { p256dh: ep.p256dh, auth: ep.web_push_auth } },
        body,
        {
          timeout: PUSH_REQUEST_TIMEOUT_MS,
          agent: pushAgent,
        },
      )
      sent++
    } catch (err) {
      const statusCode = pushStatusCode(err)
      if (statusCode === 410 || statusCode === 404) {
        pruneExpiredEndpoint(db, ep.endpoint, statusCode)
        continue
      }
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`[push] sendNotification failed for endpoint ${ep.endpoint}: ${msg}`)
      errors.push(msg)
    }
  }

  if (log) {
    try {
      writeNotificationLogRows(
        db,
        endpoints.filter((ep): ep is PushEndpointWithUser => Boolean(ep.user_uid?.trim())),
        log,
        payload,
      )
    } catch (err) {
      logger.error("[push] notification_log write failed:", err)
    }
  }

  return { sent, errors }
}

export function resolveSubscribersForPerson(
  db: Database.Database,
  personId: number,
  notifyFields: NotifyField | NotifyField[],
  opts?: { excludeUserUids?: string[]; linkedAccountOnly?: boolean },
): PushEndpointWithUser[] {
  const fields = (Array.isArray(notifyFields) ? notifyFields : [notifyFields]).map(
    f => NOTIFY_FIELD_COLUMNS[f],
  )
  if (fields.length === 0) return []

  const notifyClause = fields.map(f => `pnp.${f} = 1`).join(" OR ")
  const excludeIds = (opts?.excludeUserUids ?? []).map(u => u.trim()).filter(Boolean)
  const excludeClause =
    excludeIds.length === 0
      ? "1=1"
      : excludeIds.length === 1
        ? "pe.user_uid != ?"
        : `pe.user_uid NOT IN (${excludeIds.map(() => "?").join(", ")})`

  const linkedFilter = opts?.linkedAccountOnly
    ? `AND pe.user_uid = (
         SELECT account_uid FROM people
         WHERE id = ? AND is_active = 1
           AND account_uid IS NOT NULL AND TRIM(account_uid) != ''
       )`
    : ""

  const params: (string | number)[] = [personId, ...excludeIds]
  if (opts?.linkedAccountOnly) params.push(personId)

  const rows = db
    .prepare(
      `SELECT pe.endpoint, pe.p256dh, pe.web_push_auth, pe.user_uid
       FROM push_endpoints pe
       JOIN person_notification_prefs pnp ON pe.user_uid = pnp.user_uid
       WHERE pnp.person_id = ?
         AND (${notifyClause})
         AND ${excludeClause}
         ${linkedFilter}`,
    )
    .all(...params) as PushEndpointWithUser[]

  return rows.filter(row => pushSubscriberStillAuthorised(db, row.user_uid, personId))
}

/** Inserts push_log entry. Returns true if inserted (first send), false if already exists. */
function markSent(db: Database.Database, refKey: string): boolean {
  try {
    db.prepare("INSERT INTO push_log (ref_key) VALUES (?)").run(refKey)
    return true
  } catch {
    return false
  }
}

export function alreadySent(db: Database.Database, refKey: string): boolean {
  return !!db.prepare("SELECT 1 FROM push_log WHERE ref_key = ?").get(refKey)
}

/**
 * Optional push_log dedupe → resolve subscribers → send and log.
 */
export async function dispatchPersonPush(
  db: Database.Database,
  opts: {
    personId: number
    notifyFields: NotifyField | NotifyField[]
    payload: PushPayload
    type: string
    refKey?: string
    skipIfAlreadySent?: boolean
    excludeUserUids?: string[]
    linkedAccountOnly?: boolean
  },
): Promise<{ sent: number; errors: string[] }> {
  let claimedRefKey = false
  if (opts.refKey) {
    if (opts.skipIfAlreadySent && alreadySent(db, opts.refKey)) {
      return { sent: 0, errors: [] }
    }
    // Claim the ref key up front (atomic INSERT) so two concurrent dispatches for the same
    // event can't both send. If it turns out there's nobody to send to, the claim is released
    // below — otherwise a caregiver who subscribes *after* this tick would be permanently
    // denied that reminder, since push_log would already (falsely) say it was sent.
    if (!markSent(db, opts.refKey)) {
      return { sent: 0, errors: [] }
    }
    claimedRefKey = true
  }

  const endpoints = resolveSubscribersForPerson(db, opts.personId, opts.notifyFields, {
    excludeUserUids: opts.excludeUserUids,
    linkedAccountOnly: opts.linkedAccountOnly,
  })
  if (endpoints.length === 0) {
    if (claimedRefKey && opts.refKey) {
      db.prepare("DELETE FROM push_log WHERE ref_key = ?").run(opts.refKey)
    }
    return { sent: 0, errors: [] }
  }

  return sendAndLogPush(db, endpoints, opts.payload, {
    personId: opts.personId,
    type: opts.type,
  })
}

export function getNotificationLogForUser(
  db: Database.Database,
  userId: string,
  opts?: { limit?: number; cursor?: NotificationLogCursor | null },
): { rows: NotificationLogRow[]; nextCursor: NotificationLogCursor | null } {
  const limit = opts?.limit && opts.limit > 0 ? opts.limit : 20
  const conditions = ["nl.recipient_user_id = ?"]
  const values: (string | number)[] = [userId]

  if (opts?.cursor?.ts != null && opts.cursor.id != null) {
    conditions.push("(nl.sent_at < ? OR (nl.sent_at = ? AND nl.id < ?))")
    values.push(opts.cursor.ts, opts.cursor.ts, opts.cursor.id)
  }

  values.push(limit + 1)
  const all = db
    .prepare(
      `SELECT nl.id, nl.recipient_user_id, nl.person_id, nl.type, nl.title, nl.body, nl.sent_at,
              p.name AS person_name, p.color AS person_color
       FROM notification_log nl
       JOIN people p ON p.id = nl.person_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY nl.sent_at DESC, nl.id DESC
       LIMIT ?`,
    )
    .all(...values) as NotificationLogRow[]

  const hasMore = all.length > limit
  const rows = hasMore ? all.slice(0, limit) : all
  const nextCursor = hasMore
    ? { ts: rows[limit - 1]!.sent_at, id: rows[limit - 1]!.id }
    : null
  return { rows, nextCursor }
}

export async function sendMedicationAcknowledgementPushes(
  db: Database.Database,
  personId: number,
  medicationId: number,
  recordedByUserIds: string[],
  recorderName: string,
  personName: string,
  medicationName: string,
  recordedAt: string,
  tzOffsetMinutes: number = 0,
): Promise<void> {
  // Convert UTC timestamp to recorder's local time using their timezone offset.
  // tzOffsetMinutes = getTimezoneOffset() (negative for UTC+ zones, e.g. BST = -60).
  const localMs = new Date(recordedAt).getTime() - tzOffsetMinutes * 60_000
  const d = new Date(localMs)
  const h = d.getUTCHours()
  const m = d.getUTCMinutes()
  const ampm = h >= 12 ? "pm" : "am"
  const h12 = h % 12 || 12
  const timeStr = `${h12}:${String(m).padStart(2, "0")} ${ampm}`

  const payload: PushPayload = {
    title: "Medication given",
    body: `${recorderName} gave ${personName}'s ${medicationName} at ${timeStr}`,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    tag: `medication-reminder-${personId}-${medicationId}`,
    requireInteraction: false,
    data: {
      url: `/${personId}/history`,
      type: "acknowledgement",
    },
  }

  dispatchPersonPush(db, {
    personId,
    notifyFields: ["notify_prn", "notify_prescribed"],
    payload,
    type: "acknowledgement",
    excludeUserUids: recordedByUserIds,
  }).catch(err => logger.error("[push] acknowledgement push failed:", err))
}
