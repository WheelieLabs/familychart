// SPDX-License-Identifier: AGPL-3.0-only

export type DashboardStatus = "red" | "amber" | "green"

export type DashboardIssueKind =
  | "prescription_overdue"
  | "prescription_upcoming"
  | "dose_at_max"        // kept for type compat; no longer emitted
  | "dose_wait"          // kept for type compat; no longer emitted
  | "dose_window_open"   // kept for type compat; no longer emitted
  | "observation_overdue"
  | "prn_cooldown"       // amber, no action — waiting for chosen cadence
  | "prn_at_cap"         // red, no action — 24h cap exhausted
  | "prn_coverage_gap"   // red, with action — last dose before gap

export interface DashboardIssue {
  kind: DashboardIssueKind
  /** All current issues are red or amber. */
  severity: "red" | "amber"
  message: string
  /** Populated only for observation_overdue issues. */
  observationType?: string
  /** Populated for prescription_overdue, prescription_upcoming, dose_at_max, and dose_wait issues. */
  medicationId?: number
  /** Scheduled slot HH:mm for prescription issues (dashboard deep link). */
  scheduledSlotTime?: string
  /** Dose amount for that slot (medication catalogue unit). */
  scheduledDosage?: number
  /** Local HH:mm time when next dose is available — set for dose_wait and dose_window_open. */
  nextAvailableTime?: string
  /** Local HH:mm time when the dose window closes — set when max_hours_between is configured. */
  maxAvailableTime?: string
  /** Local HH:mm when 24h cap resets — set for prn_at_cap, prn_coverage_gap. */
  resetTime?: string
  /** Day qualifier for nextAvailableTime when it falls on a different local day. */
  nextAvailableDayQualifier?: string | null
  /** Day qualifier for resetTime when it falls on a different local day. */
  resetDayQualifier?: string | null
}

export interface AlertItem {
  severity: "red" | "amber"
  type: "medication" | "observation"
  /** Same text as DashboardIssue.message. */
  description: string
  /** null = no action button; string = deep link shown as "Record ›" */
  action_url: string | null
  sort_order: number
  /** Terse one-line glance text for the home screen (e.g. "Paracetamol · until 13:39"). */
  short: string
  /** Structured label for the person page. */
  detail: { name: string; sub: string }
}

import type { HydrationPacingStatus, PacingState } from "@/lib/hydration/hydration-pacing"

export interface HydrationStatus {
  total_ml: number
  goal_ml: number | null
  percent: number | null
  status: HydrationPacingStatus | "no_goal"
  pacing?: PacingState
  /** True when hydration pacing reminders are muted for the linked user's local today. */
  hydrationMutedToday?: boolean
}

export interface DashboardPersonStatus {
  personId: number
  personName: string
  status: DashboardStatus
  /** Primary line = first issue after priority sort, or all-clear text when green. */
  message: string
  /** All issues affecting this person, sorted by priority (optional for backward compatibility). */
  issues?: DashboardIssue[]
  summary: string
  alerts: AlertItem[]
  hydration?: HydrationStatus
}

export function issueTier(kind: DashboardIssueKind): number {
  switch (kind) {
    case "prescription_overdue":  return 0
    case "prn_coverage_gap":      return 1  // red, actionable
    case "prn_at_cap":            return 2  // red, informational
    case "dose_at_max":           return 2  // red, compat
    case "prescription_upcoming": return 3
    case "dose_wait":             return 4  // compat
    case "dose_window_open":      return 4  // compat
    case "prn_cooldown":          return 4
    case "observation_overdue":   return 5
    default:                      return 9
  }
}

/** Tie-break when tier matches (e.g. same numeric priority): overdue before upcoming. */
function prescriptionKindOrder(kind: DashboardIssueKind): number {
  if (kind === "prescription_overdue") return 0
  if (kind === "prescription_upcoming") return 1
  return 2
}

export function compareDashboardIssues(a: DashboardIssue, b: DashboardIssue): number {
  // One severity scale: red before amber
  if (a.severity !== b.severity) return a.severity === "red" ? -1 : 1
  // Within same severity, use tier ordering
  const ta = issueTier(a.kind)
  const tb = issueTier(b.kind)
  if (ta !== tb) return ta - tb
  const pa = prescriptionKindOrder(a.kind)
  const pb = prescriptionKindOrder(b.kind)
  if (pa !== pb) return pa - pb
  return a.message.localeCompare(b.message, undefined, { sensitivity: "base" })
}

/**
 * Collapses multiple issues for the same medication/observation into one, keeping
 * the highest-priority (compareDashboardIssues winner) per subject. Without this,
 * e.g. a prescription_overdue and a prescription_upcoming for the same medication
 * (or prn_at_cap and prn_cooldown) both surface as separate alerts.
 */
export function dedupeIssuesBySubject(issues: DashboardIssue[]): DashboardIssue[] {
  const winnerByKey = new Map<string, DashboardIssue>()
  let unkeyedIndex = 0
  for (const issue of issues) {
    const key = issue.medicationId != null
      ? `medication:${issue.medicationId}`
      : issue.observationType != null
        ? `observation:${issue.observationType}`
        : `unkeyed:${unkeyedIndex++}`
    const existing = winnerByKey.get(key)
    if (!existing || compareDashboardIssues(issue, existing) < 0) {
      winnerByKey.set(key, issue)
    }
  }
  return [...winnerByKey.values()]
}

export function aggregateStatusFromIssues(issues: DashboardIssue[]): DashboardStatus {
  if (issues.length === 0) return "green"
  if (issues.some(i => i.severity === "red")) return "red"
  return "amber"
}

export function formatAlertItem(
  issue: DashboardIssue,
  index: number,
  personId: number,
  medIdToName: Map<number, string>
): AlertItem {
  const medName = issue.medicationId != null
    ? (medIdToName.get(issue.medicationId) ?? "Medication")
    : null
  const obsType = issue.observationType ?? "Observation"

  let short: string
  let detailName: string
  let detailSub: string

  switch (issue.kind) {
    case "prescription_overdue":
      short = `${medName} · overdue since ${issue.scheduledSlotTime ?? "?"}`
      detailName = medName!
      detailSub = `Overdue since ${issue.scheduledSlotTime ?? "?"}`
      break
    case "prescription_upcoming":
      short = `${medName} · due at ${issue.scheduledSlotTime ?? "?"}`
      detailName = medName!
      detailSub = `Due at ${issue.scheduledSlotTime ?? "?"}`
      break
    case "prn_cooldown": {
      const q = issue.nextAvailableDayQualifier
      short = `${medName} · until ${issue.nextAvailableTime ?? "?"}${q ? ` · ${q}` : ""}`
      detailName = medName!
      detailSub = `Not available until ${issue.nextAvailableTime ?? "?"}${q ? ` ${q}` : ""}`
      break
    }
    case "prn_at_cap": {
      const q = issue.resetDayQualifier
      short = `${medName} · max${issue.resetTime ? ` — resets ${issue.resetTime}${q ? ` ${q}` : ""}` : ""}`
      detailName = medName!
      detailSub = `At 24h max${issue.resetTime ? ` — resets ${issue.resetTime}${q ? ` ${q}` : ""}` : ""}`
      break
    }
    case "prn_coverage_gap": {
      const q = issue.resetDayQualifier
      short = `${medName} · may leave a gap${issue.resetTime ? ` — resets ${issue.resetTime}${q ? ` ${q}` : ""}` : ""}`
      detailName = medName!
      detailSub = `Next dose may leave a gap${issue.resetTime ? ` — resets ${issue.resetTime}${q ? ` ${q}` : ""}` : ""}`
      break
    }
    case "dose_at_max":
      short = `${medName} · max`
      detailName = medName!
      detailSub = "At 24h max"
      break
    case "dose_wait":
      short = `${medName} · until ${issue.nextAvailableTime ?? "?"}`
      detailName = medName!
      detailSub = `Not available until ${issue.nextAvailableTime ?? "?"}`
      break
    case "dose_window_open":
      short = `${medName} · before ${issue.maxAvailableTime ?? "?"}`
      detailName = medName!
      detailSub = `Take before ${issue.maxAvailableTime ?? "?"}`
      break
    case "observation_overdue":
      short = `${obsType} · overdue`
      detailName = obsType
      detailSub = "Overdue"
      break
    default:
      short = issue.message
      detailName = medName ?? obsType
      detailSub = issue.message
  }

  // Carry the per-slot scheduled dosage on the deep link so the Record
  // Medication form prefills the correct dose, not the catalogue default.
  const dosageParam =
    issue.scheduledDosage != null && Number.isFinite(issue.scheduledDosage) && issue.scheduledDosage > 0
      ? `&dosage=${issue.scheduledDosage}`
      : ""

  const action_url: string | null =
    issue.kind === "prn_cooldown" ||
    issue.kind === "prn_at_cap" ||
    issue.kind === "dose_at_max" ||
    issue.kind === "dose_wait"
      ? null
      : issue.kind === "observation_overdue"
        ? `/${personId}/record-observation${issue.observationType ? `?type=${encodeURIComponent(issue.observationType)}` : ""}`
        : issue.medicationId != null
          ? `/${personId}/record-medication?medication_id=${issue.medicationId}${dosageParam}`
          : `/${personId}/record-medication`

  return {
    severity: issue.severity,
    type: issue.kind === "observation_overdue" ? "observation" : "medication",
    description: issue.message,
    action_url,
    sort_order: index,
    short,
    detail: { name: detailName, sub: detailSub },
  }
}
