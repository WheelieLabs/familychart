// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import type { CalendarContext } from "@/lib/calendar-context"
import type { AlertItem, DashboardPersonStatus } from "@/lib/dashboard/dashboard-status"
import {
  aggregateStatusFromIssues,
  compareDashboardIssues,
  dedupeIssuesBySubject,
  formatAlertItem,
} from "@/lib/dashboard/dashboard-status"
import { evaluateAlertReadiness } from "@/lib/alert-readiness"
import {
  buildObservationIssues,
  buildPrnFrequencyIssues,
  buildScheduledMedicationIssues,
  type DashboardIssueScheduleContext,
} from "@/lib/dashboard/dashboard-issue-builders"
import { addCalendarDaysToIsoYmd } from "@/lib/datetime"
import type { ObservationGoal, Person } from "@/lib/domain-types"
import { createHydrationEvaluator } from "@/lib/hydration/hydration-evaluate"
import { hydrationPacingAlertCopy } from "@/lib/hydration/hydration-pacing-copy"

export type DashboardPersonStatusContext = {
  now: Date
  calCtx: CalendarContext
}

/**
 * Alert-readiness facts + issue builders + hydration + alert formatting for the home dashboard.
 * Route responsibility is auth + JSON serialise only.
 */
export function evaluateDashboardPersonStatus(
  db: Database.Database,
  people: Person[],
  context: DashboardPersonStatusContext,
): DashboardPersonStatus[] {
  if (people.length === 0) return []

  const { now, calCtx } = context
  const { ymd: localTodayYmd, offsetMinutes: tzOffsetMinutes } = calCtx
  const localYesterdayYmd = addCalendarDaysToIsoYmd(localTodayYmd, -1)
  const localTomorrowYmd = addCalendarDaysToIsoYmd(localTodayYmd, 1)

  const issueSched: DashboardIssueScheduleContext = {
    now,
    tzOffsetMinutes,
    localYesterdayYmd,
    localTodayYmd,
    localTomorrowYmd,
  }

  const facts = evaluateAlertReadiness(db, people, now.getTime(), calCtx)
  const medIdToName = new Map<number, string>()
  for (const slot of facts.scheduledSlots) medIdToName.set(slot.medicationId, slot.medicationName)
  for (const slot of facts.prnBlockedSlots) medIdToName.set(slot.medicationId, slot.medicationName)
  for (const flag of facts.prnFlags) medIdToName.set(flag.medicationId, flag.medicationName)

  const hydrationGoalRows =
    people.length > 0
      ? (db
          .prepare(
            `SELECT * FROM observation_goals
         WHERE person_id IN (${people.map(() => "?").join(",")})
           AND observation_type = 'Hydration'
           AND is_active = 1`,
          )
          .all(...people.map(p => p.id)) as ObservationGoal[])
      : []
  const hydrationGoalMap = new Map(hydrationGoalRows.map(r => [r.person_id, r]))

  const hydrationEvaluator = createHydrationEvaluator(db, people, now.getTime())
  const dayCalendar = { ymd: localTodayYmd, offsetMinutes: tzOffsetMinutes }

  const out: DashboardPersonStatus[] = []

  for (const person of people) {
    const pid = person.id
    const issues = dedupeIssuesBySubject([
      ...buildScheduledMedicationIssues(person, facts),
      ...buildPrnFrequencyIssues(person, facts, issueSched),
      ...buildObservationIssues(person, facts),
    ])

    issues.sort(compareDashboardIssues)
    let status = aggregateStatusFromIssues(issues)
    const message = issues.length > 0 ? issues[0].message : "All clear"

    const alerts: AlertItem[] = issues.map((issue, i) =>
      formatAlertItem(issue, i, pid, medIdToName),
    )

    const goalRow = hydrationGoalMap.get(pid) ?? null
    const goalMl = goalRow ? goalRow.target_value : null
    const evaluated = hydrationEvaluator.evaluate(person, goalMl, dayCalendar)
    const hydration = evaluated.hydration

    const hydrationAlert =
      hydration.pacing && !hydration.hydrationMutedToday
        ? hydrationPacingAlertCopy(hydration.pacing)
        : null
    if (hydrationAlert) {
      alerts.push({
        severity: "amber",
        type: "observation",
        description: hydrationAlert.description,
        action_url: `/${pid}/record-observation?type=Hydration`,
        sort_order: alerts.length,
        short: hydrationAlert.short,
        detail: {
          name: "Hydration",
          sub: hydrationAlert.sub,
        },
      })
      if (status === "green") status = "amber"
    }

    const summary =
      alerts.length === 0
        ? "All clear"
        : alerts.length === 1
          ? alerts[0].short
          : `${alerts.length} active alerts`

    out.push({
      personId: pid,
      personName: person.name,
      status,
      message,
      issues,
      summary,
      alerts,
      hydration,
    })
  }

  return out
}
