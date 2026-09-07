// SPDX-License-Identifier: AGPL-3.0-only

import type { Person } from "@/lib/domain-types"
import type { AlertReadiness } from "@/lib/alert-readiness"
import type { DashboardIssue } from "@/lib/dashboard/dashboard-status"
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
