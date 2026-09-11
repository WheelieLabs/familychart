// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@/lib/logger"

import type Database from "better-sqlite3-multiple-ciphers"
import { getDb } from "./db"
import { evaluateAlertReadiness, type AlertReadiness } from "./alert-readiness"
import { deliverReminder } from "./cron/cron-reminder-delivery"
import { buildHydrationPayload, buildObservationPayload, buildOverduePayload, buildPrnPayload, buildScheduledPayload } from "./cron/cron-notification-payloads"
import { createHydrationEvaluator } from "./hydration/hydration-evaluate"
import { setHydrationLastNudgeAt } from "./hydration/hydration-config"
import { resolveInstanceTimezone } from "./instance-timezone"
import { pollEntraRevalidation } from "./auth/auth-revalidation"
import { prunePushSubscriptionsForUserUids } from "./push/push-subscriptions"
import type { Person } from "./domain-types"

type CronResult = { sent: number; errors: string[] }

function mergeResults(a: CronResult, b: CronResult): CronResult {
  return { sent: a.sent + b.sent, errors: [...a.errors, ...b.errors] }
}

async function runPrnReminders(db: Database.Database, facts: AlertReadiness): Promise<CronResult> {
  let result: CronResult = { sent: 0, errors: [] }

  for (const flag of facts.prnFlags) {
    if (!flag.remindAfterDue) continue
    for (const recordId of flag.remindAfterRecordIds) {
      const r = await deliverReminder(db, {
        refKey: `prn:${recordId}`,
        personId: flag.personId,
        notifyField: "notify_prn",
        skipIfAlreadySent: true,
        payload: buildPrnPayload(flag.personId, flag.medicationId, flag.personName, flag.medicationName),
      })
      result = mergeResults(result, r)
    }
  }

  return result
}

async function runScheduledReminders(db: Database.Database, facts: AlertReadiness): Promise<CronResult> {
  let result: CronResult = { sent: 0, errors: [] }
  if (!resolveInstanceTimezone(db)) return result

  for (const slot of facts.scheduledSlots) {
    if (slot.status !== "due" && slot.status !== "overdue_push") continue

    const refKey =
      slot.status === "due"
        ? `scheduled:${slot.personMedicationId}:${slot.ymd}:${slot.hhmm}`
        : `overdue:${slot.personMedicationId}:${slot.ymd}:${slot.hhmm}`

    const payload =
      slot.status === "due"
        ? buildScheduledPayload(slot.personId, slot.medicationId, slot.personName, slot.medicationName, slot.scheduledDosage)
        : buildOverduePayload(slot.personId, slot.medicationId, slot.personName, slot.medicationName, slot.scheduledDosage)
    const r = await deliverReminder(db, {
      refKey,
      personId: slot.personId,
      notifyField: slot.status === "due" ? "notify_prescribed" : "notify_overdue",
      payload,
    })
    result = mergeResults(result, r)
  }

  return result
}

async function runObservationReminders(db: Database.Database, facts: AlertReadiness): Promise<CronResult> {
  let result: CronResult = { sent: 0, errors: [] }

  if (!resolveInstanceTimezone(db)) return result

  for (const obs of facts.overdueObservations) {
    if (!obs.localYmd) continue
    const r = await deliverReminder(db, {
      refKey: `observation:${obs.expectationId}:${obs.localYmd}`,
      personId: obs.personId,
      notifyField: "notify_observations",
      skipIfAlreadySent: true,
      payload: buildObservationPayload(obs.personId, obs.personName, obs.observationType),
    })
    result = mergeResults(result, r)
  }

  return result
}

async function runHydrationReminders(db: Database.Database): Promise<CronResult> {
  const nowMs = Date.now()
  let result: CronResult = { sent: 0, errors: [] }

  const rows = db.prepare(`
    SELECT
      p.id AS person_id,
      p.name AS person_name,
      p.account_uid,
      og.target_value AS goal_ml
    FROM people p
    JOIN observation_goals og
      ON og.person_id = p.id
     AND og.observation_type = 'Hydration'
     AND og.goal_type = 'daily_min'
     AND og.is_active = 1
    WHERE p.is_active = 1
      AND p.account_uid IS NOT NULL
      AND TRIM(p.account_uid) != ''
  `).all() as {
    person_id: number
    person_name: string
    account_uid: string
    goal_ml: number
  }[]

  if (rows.length === 0) return result

  const people = rows.map(r => ({ id: r.person_id, account_uid: r.account_uid }))
  const evaluator = createHydrationEvaluator(db, people, nowMs)

  for (const row of rows) {
    const person = { id: row.person_id, account_uid: row.account_uid }
    const evaluated = evaluator.evaluate(person, row.goal_ml)

    if (!evaluated.settingsUid || !evaluated.localDayYmd) continue
    if (!evaluated.nudge?.eligible) continue
    if (evaluated.mutedToday) continue
    if (evaluated.pacing?.glassesNeededNow == null) continue

    const refKey = `hydration:${row.person_id}:${evaluated.localDayYmd}:${nowMs}`
    const r = await deliverReminder(db, {
      refKey,
      personId: row.person_id,
      notifyField: "notify_hydration",
      payload: buildHydrationPayload(
        row.person_id,
        row.person_name,
        evaluated.pacing.glassesNeededNow,
      ),
    })
    if (r.sent > 0) {
      setHydrationLastNudgeAt(db, evaluated.settingsUid, nowMs)
    }
    result = mergeResults(result, r)
  }

  return result
}

function cleanupScheduleSuppressions(db: Database.Database): void {
  const cutoff = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  db.prepare("DELETE FROM schedule_reminder_suppressions WHERE local_ymd < ?").run(cutoff)
}

export async function runCronJobs(): Promise<CronResult> {
  const db = getDb()
  cleanupScheduleSuppressions(db)
  const people = db.prepare(`SELECT * FROM people WHERE is_active = 1`).all() as Person[]
  const facts = evaluateAlertReadiness(db, people, Date.now())
  const r1 = await runPrnReminders(db, facts)
  const r2 = await runScheduledReminders(db, facts)
  const r3 = await runObservationReminders(db, facts)
  const r4 = await runHydrationReminders(db)
  // Entra revalidation: 5th job, self-gated to run hourly (no-ops on the other 5-min ticks).
  const r5 = await pollEntraRevalidation(db)
  // Graph-detected account disable — drop push subscriptions for those OIDs.
  if (r5.revokedExternalIds.length > 0) {
    prunePushSubscriptionsForUserUids(db, r5.revokedExternalIds)
  }
  const result = {
    sent: r1.sent + r2.sent + r3.sent + r4.sent,
    errors: [...r1.errors, ...r2.errors, ...r3.errors, ...r4.errors, ...r5.errors],
  }
  if (result.errors.length > 0) {
    logger.error("cron_job_errors", { sent: result.sent, error_count: result.errors.length, errors: result.errors })
  } else if (result.sent > 0) {
    logger.info("cron_run", { sent: result.sent, errors: 0 })
  }
  return result
}

let cronInitialised = false

export function initInternalCron(): void {
  if (cronInitialised) return
  cronInitialised = true
  logger.info("internal_cron_started", { interval_ms: 5 * 60 * 1000 })

  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await runCronJobs()
    } catch (err) {
      logger.error("[cron] tick failed:", err)
    } finally {
      running = false
    }
  }

  // Initial run after startup delay, then every 5 minutes
  setTimeout(() => {
    tick()
    setInterval(tick, 5 * 60 * 1000)
  }, 30_000)
}
