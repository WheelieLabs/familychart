// SPDX-License-Identifier: AGPL-3.0-only

import type { Person } from "@/lib/domain-types"
import type { AlertReadiness } from "@/lib/alert-readiness"
import { formatShortDay, type DashboardIssue } from "@/lib/dashboard/dashboard-status"
import type { OpenSymptomPrompt } from "@/lib/symptoms/open-symptom-prompts"
import { overdueMessage } from "@/lib/observation/observation-recurrence"
import { formatHHMM, dayQualifierForYmd, utcMsToLocalYmd } from "@/lib/datetime"

export interface DashboardIssueScheduleContext {
  now: Date
  tzOffsetMinutes: number
  localYesterdayYmd: string
  localTodayYmd: string
  localTomorrowYmd: string
}

export function buildScheduledMedicationIssues(
  person: Person,
  facts: AlertReadiness,
): DashboardIssue[] {
  const issues: DashboardIssue[] = []
  for (const slot of facts.scheduledSlots) {
    if (slot.personId !== person.id) continue
    if (slot.status === "upcoming") {
      issues.push({
        kind: "prescription_upcoming",
        severity: "amber",
        message: `${slot.medicationName} — next dose due at ${slot.scheduledTime}`,
        medicationId: slot.medicationId,
        scheduledSlotTime: slot.scheduledTime,
        scheduledDosage: slot.scheduledDosage,
      })
    } else {
      issues.push({
        kind: "prescription_overdue",
        severity: "red",
        message: `${slot.medicationName} — overdue since ${slot.scheduledTime}`,
        medicationId: slot.medicationId,
        scheduledSlotTime: slot.scheduledTime,
        scheduledDosage: slot.scheduledDosage,
      })
    }
  }
  return issues
}

/** Doses expected away from home that are awaiting the parent's yes / no / not-yet. */
export function buildPendingDoseExpectationIssues(
  person: Person,
  facts: AlertReadiness,
): DashboardIssue[] {
  return facts.pendingDoseExpectations
    .filter(p => p.personId === person.id)
    .map(p => ({
      kind: "dose_expectation_pending" as const,
      severity: "amber" as const,
      message: `${p.medicationName} — was the ${p.hhmm} dose given away from home?`,
      medicationId: p.medicationId,
      scheduledSlotTime: p.hhmm,
      scheduledDosage: p.scheduledDosage,
      expectation: { expectationId: p.expectationId, ymd: p.ymd },
    }))
}

/** One notice per Open symptom awaiting today's "still ongoing or resolved?" for this person. */
export function buildOpenSymptomIssues(person: Person, prompts: OpenSymptomPrompt[]): DashboardIssue[] {
  return prompts
    .filter(p => p.personId === person.id)
    .map(p => ({
      kind: "symptom_open_pending" as const,
      severity: "notice" as const,
      message: `${p.label} — open since ${formatShortDay(p.startYmd)}: still ongoing?`,
      symptom: { symptomId: p.symptomId, startYmd: p.startYmd, label: p.label },
    }))
}

export function buildPrnFrequencyIssues(
  person: Person,
  facts: AlertReadiness,
  sched: DashboardIssueScheduleContext,
): DashboardIssue[] {
  const issues: DashboardIssue[] = []
  const { tzOffsetMinutes, localTodayYmd, localTomorrowYmd } = sched

  for (const flag of facts.prnFlags) {
    if (flag.personId !== person.id) continue

    if (flag.atCap || (flag.coverageGap && !flag.cooldown)) {
      let resetTimeStr: string | undefined
      let resetDayQualifier: string | null = null
      if (flag.resetAtMs != null) {
        const localMs = flag.resetAtMs - tzOffsetMinutes * 60_000
        const d = new Date(localMs)
        resetTimeStr = formatHHMM(d.getUTCHours(), d.getUTCMinutes())
        const resetYmd = utcMsToLocalYmd(flag.resetAtMs, tzOffsetMinutes)
        resetDayQualifier = dayQualifierForYmd(resetYmd, localTodayYmd, localTomorrowYmd)
      }
      issues.push({
        kind: flag.atCap ? "prn_at_cap" : "prn_coverage_gap",
        severity: "red",
        message: flag.atCap ? `${flag.medicationName} at 24h max` : `${flag.medicationName} — next dose may leave a gap`,
        medicationId: flag.medicationId,
        resetTime: resetTimeStr,
        resetDayQualifier,
      })
    }

    if (flag.cooldown && flag.availableAtMs != null) {
      const localMs = flag.availableAtMs - tzOffsetMinutes * 60_000
      const d = new Date(localMs)
      const availTimeStr = formatHHMM(d.getUTCHours(), d.getUTCMinutes())
      const availYmd = utcMsToLocalYmd(flag.availableAtMs, tzOffsetMinutes)
      const nextAvailableDayQualifier = dayQualifierForYmd(availYmd, localTodayYmd, localTomorrowYmd)
      issues.push({
        kind: "prn_cooldown",
        severity: "amber",
        message: `${flag.medicationName} — not available until ${availTimeStr}${nextAvailableDayQualifier ? ` ${nextAvailableDayQualifier}` : ""}`,
        medicationId: flag.medicationId,
        nextAvailableTime: availTimeStr,
        nextAvailableDayQualifier,
      })
    }
  }

  return issues
}

export function buildObservationIssues(person: Person, facts: AlertReadiness): DashboardIssue[] {
  const issues: DashboardIssue[] = []
  for (const obs of facts.overdueObservations) {
    if (obs.personId !== person.id) continue
    issues.push({
      kind: "observation_overdue",
      severity: "amber",
      message: overdueMessage(obs.observationType),
      observationType: obs.observationType,
    })
  }
  return issues
}
