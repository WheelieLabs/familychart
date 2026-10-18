// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { hydrationSettingsCandidateUids } from "@/lib/account/account-identity"
import { buildHydrationCaughtUpPayload, buildHydrationUpdatePayload } from "@/lib/cron/cron-notification-payloads"
import {
  hydrationLastNudgeAtFromStored,
  hydrationLastRecordAtFromStored,
  loadHydrationSettingRowsForUserUids,
  mergeHydrationStoredForCandidateUids,
  setHydrationLastNudgeAt,
  setHydrationLastRecordAt,
} from "@/lib/hydration/hydration-config"
import { createHydrationEvaluator } from "@/lib/hydration/hydration-evaluate"
import type { PacingState } from "@/lib/hydration/hydration-pacing"
import { dispatchPersonPush, type PushPayload } from "@/lib/push"
import { hydrationReminderTag } from "@/lib/push/notification-tags"

/** What a saved hydration reading does to the pacing notification. */
export type HydrationNotificationDecision =
  | { kind: "none" }
  | { kind: "clear" }
  | { kind: "update"; glassesNeededNow: number }

const DAY_MS = 24 * 60 * 60_000

/**
 * True while a pacing nudge is on screen that no reading has answered: one went out after the last
 * reading, and not more than a day ago. A reading with nothing outstanding must never create a
 * notification, so the decision below sends nothing without this.
 */
export function hydrationNudgeOutstanding(input: {
  lastNudgeAtMs: number | null
  lastRecordAtMs: number | null
  nowMs: number
}): boolean {
  if (input.lastNudgeAtMs == null) return false
  if (input.nowMs - input.lastNudgeAtMs > DAY_MS) return false
  return input.lastNudgeAtMs >= (input.lastRecordAtMs ?? 0)
}

/**
 * Clear / update / nothing, from the existing pacing calculation. Muted today sends nothing. Caught
 * up (on pace or goal met) clears; still behind updates to the new count. Before the window opens or
 * after it closes there is no pacing to report, so nothing changes.
 */
export function decideHydrationNotification(input: {
  mutedToday: boolean
  pacing: PacingState | null
  nudgeOutstanding: boolean
}): HydrationNotificationDecision {
  if (input.mutedToday || !input.nudgeOutstanding || !input.pacing) return { kind: "none" }
  const { status, glassesNeededNow } = input.pacing
  if (status === "met" || status === "on_pace") return { kind: "clear" }
  if (status === "behind" && glassesNeededNow != null && glassesNeededNow > 0) {
    return { kind: "update", glassesNeededNow }
  }
  return { kind: "none" }
}

export interface HydrationNotificationPlan {
  decision: HydrationNotificationDecision
  settingsUid: string | null
}

/**
 * Recompute pacing after a reading is saved and decide what happens to the notification. Call it
 * before the route records this reading's time, since "outstanding" compares against the previous one.
 */
export function planHydrationNotification(
  db: Database.Database,
  person: { id: number; account_uid: string | null },
  nowMs: number,
): HydrationNotificationPlan {
  const none: HydrationNotificationPlan = { decision: { kind: "none" }, settingsUid: null }
  // Only a Person linked to an Account gets hydration notifications.
  if (!person.account_uid?.trim()) return none
  const goal = db
    .prepare(
      `SELECT target_value AS goal_ml FROM observation_goals
        WHERE person_id = ? AND observation_type = 'Hydration' AND goal_type = 'daily_min' AND is_active = 1`,
    )
    .get(person.id) as { goal_ml: number } | undefined
  if (!goal) return none

  const evaluated = createHydrationEvaluator(db, [person], nowMs).evaluate(person, goal.goal_ml)
  if (!evaluated.settingsUid) return none

  const candidates = hydrationSettingsCandidateUids(db, person)
  const stored = mergeHydrationStoredForCandidateUids(loadHydrationSettingRowsForUserUids(db, candidates), candidates)
  const outstanding = hydrationNudgeOutstanding({
    lastNudgeAtMs: hydrationLastNudgeAtFromStored(stored),
    lastRecordAtMs: hydrationLastRecordAtFromStored(stored),
    nowMs,
  })
  return {
    settingsUid: evaluated.settingsUid,
    decision: decideHydrationNotification({
      mutedToday: evaluated.mutedToday,
      pacing: evaluated.pacing,
      nudgeOutstanding: outstanding,
    }),
  }
}

/** The notification the recording device shows or closes itself; null when nothing changes. */
export function hydrationRecordingDeviceNotification(
  decision: HydrationNotificationDecision,
  personId: number,
  personName: string,
): { action: "close" | "update"; tag: string; payload?: PushPayload } | null {
  const tag = hydrationReminderTag(personId)
  if (decision.kind === "clear") return { action: "close", tag }
  if (decision.kind === "update") {
    return { action: "update", tag, payload: buildHydrationUpdatePayload(personId, personName, decision.glassesNeededNow) }
  }
  return null
}

/**
 * Sends the quiet replacement to the linked Account's other devices and moves the nudge bookkeeping:
 * an update keeps the nudge outstanding, a clear ends it. Recipients stay the linked Account only,
 * and the recording device is skipped (it updates or closes its own notification by tag).
 */
export async function applyHydrationNotification(
  db: Database.Database,
  opts: {
    personId: number
    personName: string
    decision: HydrationNotificationDecision
    settingsUid: string | null
    nowMs: number
    recordingEndpoint: string | null
  },
): Promise<{ sent: number; errors: string[] }> {
  const { decision } = opts
  if (decision.kind === "none") return { sent: 0, errors: [] }

  if (opts.settingsUid) {
    if (decision.kind === "update") setHydrationLastNudgeAt(db, opts.settingsUid, opts.nowMs)
    else setHydrationLastRecordAt(db, opts.settingsUid, opts.nowMs)
  }
  return dispatchPersonPush(db, {
    personId: opts.personId,
    notifyFields: "notify_hydration",
    payload:
      decision.kind === "update"
        ? buildHydrationUpdatePayload(opts.personId, opts.personName, decision.glassesNeededNow)
        : buildHydrationCaughtUpPayload(opts.personId, opts.personName),
    type: "hydration",
    linkedAccountOnly: true,
    excludeEndpoints: opts.recordingEndpoint ? [opts.recordingEndpoint] : undefined,
    writeLog: false,
  })
}
