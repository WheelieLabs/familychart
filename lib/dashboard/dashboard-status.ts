// SPDX-License-Identifier: AGPL-3.0-only

/** Notice sits between amber and green: nothing needs care attention, but something wants a quick confirmation. */
export type DashboardStatus = "red" | "amber" | "notice" | "green"

/** Severity of one issue or alert: red outranks amber outranks notice. */
export type DashboardSeverity = "red" | "amber" | "notice"

const SEVERITY_RANK: Record<DashboardSeverity, number> = { red: 0, amber: 1, notice: 2 }

export type DashboardIssueKind =
  | "prescription_overdue"
  | "prescription_upcoming"
  | "observation_overdue"
  | "prn_cooldown"       // amber, no action — waiting for chosen cadence
  | "prn_at_cap"         // red, no action — 24h cap exhausted
  | "prn_coverage_gap"   // red, with action — last dose before gap
  | "dose_expectation_pending" // amber — a dose expected away from home awaits confirmation
  | "symptom_open_pending"     // notice — an Open symptom awaits its daily "still ongoing or resolved?"

export interface DashboardIssue {
  kind: DashboardIssueKind
  severity: DashboardSeverity
  message: string
  /** Populated only for observation_overdue issues. */
  observationType?: string
  /** Populated for prescription and PRN medication issues. */
  medicationId?: number
  /** Scheduled slot HH:mm for prescription issues (dashboard deep link). */
  scheduledSlotTime?: string
  /** Dose amount for that slot (medication catalogue unit). */
  scheduledDosage?: number
  /** Local HH:mm time when next dose is available — set for prn_cooldown. */
  nextAvailableTime?: string
  /** Local HH:mm time when the dose window closes — set when max_hours_between is configured. */
  maxAvailableTime?: string
  /** Local HH:mm when 24h cap resets — set for prn_at_cap, prn_coverage_gap. */
  resetTime?: string
  /** Day qualifier for nextAvailableTime when it falls on a different local day. */
  nextAvailableDayQualifier?: string | null
  /** Day qualifier for resetTime when it falls on a different local day. */
  resetDayQualifier?: string | null
  /** Populated only for dose_expectation_pending issues: which expectation/day to resolve. */
  expectation?: { expectationId: number; ymd: string }
  /** Populated only for symptom_open_pending issues: which symptom to answer, and its start day. */
  symptom?: { symptomId: number; startYmd: string; label: string }
}

export interface AlertItem {
  severity: DashboardSeverity
  type: "medication" | "observation" | "symptom"
  /** Same text as DashboardIssue.message. */
  description: string
  /** null = no action button; string = deep link shown as "Record ›" */
  action_url: string | null
  sort_order: number
  /** Terse one-line glance text for the home screen (e.g. "Paracetamol · until 13:39"). */
  short: string
  /** Structured label for the person page. */
  detail: { name: string; sub: string }
  /** Set when the alert is resolved inline (Yes / No / Not yet) instead of by navigating. */
  resolve?: { expectationId: number; ymd: string }
  /** Set when an Open symptom is answered inline (Still ongoing / Resolved). */
  resolveSymptom?: { symptomId: number; startYmd: string }
}

import type { DashboardMissedSlot } from "@/lib/dashboard/dashboard-missed-slots"
import type { HydrationPacingStatus, PacingState } from "@/lib/hydration/hydration-pacing"
import type { MedicationTimelineLane } from "@/lib/medication/medication-timeline"

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
  /** Per-medication coverage/gap timeline lanes for the Action screen. */
  medicationTimeline?: MedicationTimelineLane[]
  /**
   * Slots that became Missed today: quiet information, never an alert. Not counted in `alerts`,
   * `issues` or `status`, and gone when the Calendar day ends.
   */
  missedSlots?: DashboardMissedSlot[]
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "2026-10-02" -> "2 Oct". */
export function formatShortDay(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number)
  return `${d} ${MONTH_SHORT[(m ?? 1) - 1]}`
}

export function issueTier(kind: DashboardIssueKind): number {
  switch (kind) {
    case "prescription_overdue":  return 0
    case "prn_coverage_gap":      return 1  // red, actionable
    case "prn_at_cap":            return 2  // red, informational
    case "prescription_upcoming": return 3
    case "prn_cooldown":          return 4
    case "dose_expectation_pending": return 4
    case "symptom_open_pending":  return 4
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
  // One severity scale: red, then amber, then notice
  if (a.severity !== b.severity) return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
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
    const key = issue.symptom != null
      ? `symptom:${issue.symptom.symptomId}`
      : issue.expectation != null
      ? `expectation:${issue.expectation.expectationId}:${issue.expectation.ymd}`
      : issue.medicationId != null
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
  if (issues.some(i => i.severity === "amber")) return "amber"
  return "notice"
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
    case "dose_expectation_pending":
      short = `${medName} · ${issue.scheduledSlotTime ?? "?"} away from home?`
      detailName = medName!
      detailSub = `Was the ${issue.scheduledSlotTime ?? "?"} dose given away from home?`
      break
    case "symptom_open_pending": {
      const label = issue.symptom?.label ?? "Symptom"
      const since = issue.symptom ? formatShortDay(issue.symptom.startYmd) : "?"
      short = `${label} · open since ${since}`
      detailName = label
      detailSub = `Open since ${since}: still ongoing?`
      break
    }
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
    issue.kind === "dose_expectation_pending" ||
    issue.kind === "symptom_open_pending"
      ? null
      : issue.kind === "observation_overdue"
        ? `/${personId}/record-observation${issue.observationType ? `?type=${encodeURIComponent(issue.observationType)}` : ""}`
        : issue.medicationId != null
          ? `/${personId}/record-medication?medication_id=${issue.medicationId}${dosageParam}`
          : `/${personId}/record-medication`

  return {
    severity: issue.severity,
    type: issue.kind === "observation_overdue" ? "observation" : issue.kind === "symptom_open_pending" ? "symptom" : "medication",
    description: issue.message,
    action_url,
    sort_order: index,
    short,
    detail: { name: detailName, sub: detailSub },
    ...(issue.expectation ? { resolve: issue.expectation } : {}),
    ...(issue.symptom ? { resolveSymptom: { symptomId: issue.symptom.symptomId, startYmd: issue.symptom.startYmd } } : {}),
  }
}
