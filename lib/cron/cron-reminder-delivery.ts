// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import {
  alreadySent,
  dispatchPersonPush,
  notifyFieldToLogType,
  type NotifyField,
  type PushPayload,
} from "@/lib/push"

export type { NotifyField }
export type ReminderPushPayload = PushPayload
export { alreadySent }

/**
 * Dedupe, resolve subscribers, send, and log one reminder push.
 * When skipIfAlreadySent is true, returns early if ref_key is already in push_log.
 */
export async function deliverReminder(
  db: Database.Database,
  opts: {
    refKey: string
    personId: number
    notifyField: NotifyField
    payload: ReminderPushPayload
    skipIfAlreadySent?: boolean
  },
): Promise<{ sent: number; errors: string[] }> {
  return dispatchPersonPush(db, {
    personId: opts.personId,
    notifyFields: opts.notifyField,
    payload: opts.payload,
    type: notifyFieldToLogType(opts.notifyField),
    refKey: opts.refKey,
    skipIfAlreadySent: opts.skipIfAlreadySent,
    linkedAccountOnly: opts.notifyField === "notify_hydration",
  })
}
