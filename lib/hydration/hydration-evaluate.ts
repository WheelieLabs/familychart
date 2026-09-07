// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { hydrationSettingsCandidateUids, resolveHydrationSettingsUid } from "@/lib/account/account-identity"
import {
  addCalendarDaysToIsoYmd,
  ianaLocalYmdHmToUtcMs,
  localCalendarYmdHmToUtcMs,
  tzLocalYmdAndOffset,
  utcMsToLocalMinutesSinceMidnight,
} from "@/lib/datetime"
import type { Person } from "@/lib/domain-types"
import type { HydrationStatus } from "@/lib/dashboard/dashboard-status"
import {
  hydrationLastNudgeAtFromStored,
  hydrationLastRecordAtFromStored,
  hydrationMutedUntilFromStored,
  isHydrationMutedForLocalDay,
  loadHydrationSettingRowsForUserUids,
  mergeHydrationStoredForCandidateUids,
  resolveHydrationWindowMinutesFromStored,
  type HydrationSettingRow,
} from "@/lib/hydration/hydration-config"
import {
  evaluateHydrationNudgeFromPacing,
  type HydrationNudgeDecision,
} from "@/lib/hydration/hydration-nudge-decision"
import { computeHydrationPacing, type PacingState } from "@/lib/hydration/hydration-pacing"
import {
  loadUserHydrationTimezonesForUserUids,
  resolveHydrationLocalDay,
  resolveHydrationTimezone,
  resolveHydrationTimezoneForCandidates,
} from "@/lib/hydration/hydration-timezone"

export function getTodayHydrationTotal(
  db: Database.Database,
  personId: number,
  startUtcIso: string,
  endUtcIso: string
): { total_ml: number } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(
         CASE WHEN LOWER(unit) = 'l' THEN value * 1000 ELSE value END
       ), 0) AS total_ml
       FROM observations
       WHERE person_id = ?
         AND observation_type = 'Hydration'
         AND recorded_at >= ? AND recorded_at < ?`
    )
    .get(personId, startUtcIso, endUtcIso) as { total_ml: number }
}

export type HydrationPersonRef = Pick<Person, "id" | "account_uid">

/**
 * Optional client calendar for dashboard day totals / local minutes.
 * When omitted, evaluation uses the person's resolved hydration IANA timezone (cron path).
 */
export type HydrationDayCalendar = {
  ymd: string
  offsetMinutes: number
}

export type HydrationEvaluation = {
  /** Dashboard-shaped hydration block. */
  hydration: HydrationStatus
  pacing: PacingState | null
  mutedToday: boolean
  nudge: HydrationNudgeDecision | null
  settingsUid: string | null
  /** Local YMD in hydration timezone (mute / cron ref keys); null when tz unresolved. */
  localDayYmd: string | null
}

type PersonHydrationIdentity = {
  writeUid: string | null
  candidates: string[]
}

/**
 * Batch-friendly hydration evaluator, collapsing hydration evaluation into a single seam.
 * Callers preload once for a people set, then evaluate per person.
 */
export type HydrationEvaluator = {
  evaluate(
    person: HydrationPersonRef,
    goalMl: number | null,
    dayCalendar?: HydrationDayCalendar,
  ): HydrationEvaluation
}

export function createHydrationEvaluator(
  db: Database.Database,
  people: HydrationPersonRef[],
  nowMs: number,
): HydrationEvaluator {
  const identityByPersonId = new Map<number, PersonHydrationIdentity>()
  const allCandidateUids = new Set<string>()

  for (const person of people) {
    const writeUid = resolveHydrationSettingsUid(db, person)
    const candidates = hydrationSettingsCandidateUids(db, person)
    identityByPersonId.set(person.id, { writeUid, candidates })
    for (const uid of candidates) allCandidateUids.add(uid)
  }

  const settingRows = loadHydrationSettingRowsForUserUids(db, [...allCandidateUids])
  const userTzByUid = loadUserHydrationTimezonesForUserUids(db, [...allCandidateUids])

  return {
    evaluate(person, goalMl, dayCalendar) {
      return evaluateHydrationFromBatch(db, {
        person,
        goalMl,
        nowMs,
        dayCalendar,
        identity: identityByPersonId.get(person.id) ?? {
          writeUid: resolveHydrationSettingsUid(db, person),
          candidates: hydrationSettingsCandidateUids(db, person),
        },
        settingRows,
        userTzByUid,
      })
    },
  }
}

/**
 * Single-person hydration evaluation.
 * Prefer createHydrationEvaluator when evaluating many people.
 */
export function evaluateHydration(
  db: Database.Database,
  person: HydrationPersonRef,
  now: Date | number,
  options?: {
    goalMl?: number | null
    dayCalendar?: HydrationDayCalendar
  },
): HydrationEvaluation {
  const nowMs = typeof now === "number" ? now : now.getTime()
  const evaluator = createHydrationEvaluator(db, [person], nowMs)
  return evaluator.evaluate(person, options?.goalMl ?? null, options?.dayCalendar)
}

function evaluateHydrationFromBatch(
  db: Database.Database,
  args: {
    person: HydrationPersonRef
    goalMl: number | null
    nowMs: number
    dayCalendar?: HydrationDayCalendar
    identity: PersonHydrationIdentity
    settingRows: HydrationSettingRow[]
    userTzByUid: Map<string, string>
  },
): HydrationEvaluation {
  const { person, goalMl, nowMs, dayCalendar, identity, settingRows, userTzByUid } = args
  const { writeUid, candidates } = identity

  if (goalMl === null) {
    return {
      hydration: { total_ml: 0, goal_ml: null, percent: null, status: "no_goal" },
      pacing: null,
      mutedToday: false,
      nudge: null,
      settingsUid: writeUid,
      localDayYmd: null,
    }
  }

  const stored = mergeHydrationStoredForCandidateUids(settingRows, candidates)

  const hydrationLocalDay =
    writeUid != null
      ? resolveHydrationLocalDay(db, writeUid, nowMs, {
          userTz: resolveHydrationTimezoneForCandidates({
            writeUid,
            candidateUids: candidates,
            userTzByUid,
          }),
        })
      : null

  let dayYmd: string | null
  let offsetMinutes: number | null
  let ianaTz: string | null = null

  if (dayCalendar) {
    dayYmd = dayCalendar.ymd
    offsetMinutes = dayCalendar.offsetMinutes
  } else if (writeUid) {
    const resolved = resolveHydrationTimezone(db, {
      userUid: writeUid,
      userTz: resolveHydrationTimezoneForCandidates({
        writeUid,
        candidateUids: candidates,
        userTzByUid,
      }),
    })
    ianaTz = resolved.tz
    if (!ianaTz) {
      return {
        hydration: {
          total_ml: 0,
          goal_ml: goalMl,
          percent: 0,
          status: "before_window",
          pacing: undefined,
          hydrationMutedToday: false,
        },
        pacing: null,
        mutedToday: false,
        nudge: null,
        settingsUid: writeUid,
        localDayYmd: null,
      }
    }
    const local = tzLocalYmdAndOffset(nowMs, ianaTz)
    dayYmd = local.ymd
    offsetMinutes = local.offsetMinutes
  } else {
    return {
      hydration: {
        total_ml: 0,
        goal_ml: goalMl,
        percent: 0,
        status: "before_window",
      },
      pacing: null,
      mutedToday: false,
      nudge: null,
      settingsUid: null,
      localDayYmd: null,
    }
  }

  const tomorrowYmd = addCalendarDaysToIsoYmd(dayYmd!, 1)
  const startUtc = new Date(
    ianaTz
      ? ianaLocalYmdHmToUtcMs(dayYmd!, "00:00", ianaTz)
      : localCalendarYmdHmToUtcMs(dayYmd!, "00:00", offsetMinutes!),
  ).toISOString()
  const endUtc = new Date(
    ianaTz
      ? ianaLocalYmdHmToUtcMs(tomorrowYmd, "00:00", ianaTz)
      : localCalendarYmdHmToUtcMs(tomorrowYmd, "00:00", offsetMinutes!),
  ).toISOString()

  const { total_ml } = getTodayHydrationTotal(db, person.id, startUtc, endUtc)
  const percent = Math.round((total_ml / goalMl) * 100)
  const nowLocalMinutes = utcMsToLocalMinutesSinceMidnight(nowMs, offsetMinutes!)
  const hydrationWindow = resolveHydrationWindowMinutesFromStored(writeUid, stored)
  const pacing = computeHydrationPacing({
    activeStart: hydrationWindow.activeStartMin,
    activeEnd: hydrationWindow.activeEndMin,
    glassSize: hydrationWindow.glassSize,
    target: goalMl,
    consumed: total_ml,
    nowLocalMinutes,
  })

  const muteYmd = hydrationLocalDay?.ymd ?? dayYmd!
  const mutedToday = isHydrationMutedForLocalDay(hydrationMutedUntilFromStored(stored), muteYmd)

  const nudge =
    writeUid != null
      ? evaluateHydrationNudgeFromPacing({
          isUser: true,
          activeStartMin: hydrationWindow.activeStartMin,
          activeEndMin: hydrationWindow.activeEndMin,
          nowLocalMinutes,
          targetMl: goalMl,
          lastNudgeAtMs: hydrationLastNudgeAtFromStored(stored),
          lastRecordAtMs: hydrationLastRecordAtFromStored(stored),
          nowMs,
          pacing,
        })
      : null

  const hydration: HydrationStatus = {
    total_ml,
    goal_ml: goalMl,
    percent,
    status: pacing.status,
    pacing,
    hydrationMutedToday: mutedToday,
  }

  return {
    hydration,
    pacing,
    mutedToday,
    nudge,
    settingsUid: writeUid,
    localDayYmd: hydrationLocalDay?.ymd ?? dayYmd,
  }
}
