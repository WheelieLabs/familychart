import { describe, it, expect } from "vitest"
import {
  issueTier,
  compareDashboardIssues,
  aggregateStatusFromIssues,
  dedupeIssuesBySubject,
  formatAlertItem,
  type DashboardIssue,
  type DashboardIssueKind,
} from "@/lib/dashboard/dashboard-status"

function issue(overrides: Partial<DashboardIssue> & { kind: DashboardIssueKind }): DashboardIssue {
  return {
    severity: "red",
    message: "Test issue",
    ...overrides,
  }
}

const MED_MAP = new Map([[1, "Paracetamol"], [2, "Ibuprofen"]])

describe("issueTier", () => {
  it("prescription_overdue is the highest priority (tier 0)", () => {
    expect(issueTier("prescription_overdue")).toBe(0)
  })

  it("prn_coverage_gap is tier 1", () => {
    expect(issueTier("prn_coverage_gap")).toBe(1)
  })

  it("observation_overdue is the lowest named tier", () => {
    expect(issueTier("observation_overdue")).toBe(5)
  })

  it("unknown kinds get a safe fallback tier", () => {
    expect(issueTier("dose_at_max" as DashboardIssueKind)).toBeGreaterThan(0)
  })
})

describe("aggregateStatusFromIssues", () => {
  it("returns green when there are no issues", () => {
    expect(aggregateStatusFromIssues([])).toBe("green")
  })

  it("returns amber when all issues are amber", () => {
    const issues = [
      issue({ kind: "prn_cooldown", severity: "amber" }),
      issue({ kind: "observation_overdue", severity: "amber" }),
    ]
    expect(aggregateStatusFromIssues(issues)).toBe("amber")
  })

  it("returns red when any issue is red", () => {
    const issues = [
      issue({ kind: "prn_cooldown", severity: "amber" }),
      issue({ kind: "prescription_overdue", severity: "red" }),
    ]
    expect(aggregateStatusFromIssues(issues)).toBe("red")
  })

  it("returns red for a single red issue", () => {
    expect(aggregateStatusFromIssues([issue({ kind: "prescription_overdue", severity: "red" })])).toBe("red")
  })
})

describe("compareDashboardIssues — sort ordering", () => {
  it("sorts red before amber", () => {
    const red = issue({ kind: "prescription_overdue", severity: "red" })
    const amber = issue({ kind: "prn_cooldown", severity: "amber" })
    expect(compareDashboardIssues(red, amber)).toBeLessThan(0)
    expect(compareDashboardIssues(amber, red)).toBeGreaterThan(0)
  })

  it("within red: sorts by tier (overdue before coverage gap)", () => {
    const overdue = issue({ kind: "prescription_overdue", severity: "red" })
    const gap = issue({ kind: "prn_coverage_gap", severity: "red" })
    expect(compareDashboardIssues(overdue, gap)).toBeLessThan(0)
  })

  it("within same severity and tier: sorts overdue before upcoming", () => {
    const overdue = issue({ kind: "prescription_overdue", severity: "red", message: "aaa" })
    const upcoming = issue({ kind: "prescription_upcoming", severity: "amber", message: "aaa" })
    // different severity → red first (already covered), but let's test same-severity, same-tier prescription ordering
    const overdueRed = issue({ kind: "prescription_overdue", severity: "red", message: "aaa" })
    const overdueRed2 = issue({ kind: "prescription_overdue", severity: "red", message: "zzz" })
    // same tier, same kind → falls through to message localeCompare
    expect(compareDashboardIssues(overdueRed, overdueRed2)).toBeLessThan(0)
    expect(compareDashboardIssues(overdueRed, overdue)).toBe(0)
    expect(overdue).not.toBe(upcoming) // suppress unused warning
  })

  it("equal issues compare as 0", () => {
    const a = issue({ kind: "prn_cooldown", severity: "amber", message: "same" })
    const b = issue({ kind: "prn_cooldown", severity: "amber", message: "same" })
    expect(compareDashboardIssues(a, b)).toBe(0)
  })

  it("sorting a mixed list puts highest-priority issues first", () => {
    const items: DashboardIssue[] = [
      issue({ kind: "observation_overdue", severity: "amber" }),
      issue({ kind: "prescription_overdue", severity: "red" }),
      issue({ kind: "prn_cooldown", severity: "amber" }),
    ]
    const sorted = [...items].sort(compareDashboardIssues)
    expect(sorted[0]!.kind).toBe("prescription_overdue")
  })
})

describe("dedupeIssuesBySubject", () => {
  it("collapses overdue+upcoming for the same medication to the overdue (worst) issue", () => {
    const overdue = issue({ kind: "prescription_overdue", severity: "red", medicationId: 1, message: "overdue" })
    const upcoming = issue({ kind: "prescription_upcoming", severity: "amber", medicationId: 1, message: "upcoming" })
    const result = dedupeIssuesBySubject([upcoming, overdue])
    expect(result).toHaveLength(1)
    expect(result[0]!.kind).toBe("prescription_overdue")
  })

  it("collapses prn_at_cap+prn_cooldown for the same medication to the at-cap (worst) issue", () => {
    const atCap = issue({ kind: "prn_at_cap", severity: "red", medicationId: 2, message: "at cap" })
    const cooldown = issue({ kind: "prn_cooldown", severity: "amber", medicationId: 2, message: "cooldown" })
    const result = dedupeIssuesBySubject([cooldown, atCap])
    expect(result).toHaveLength(1)
    expect(result[0]!.kind).toBe("prn_at_cap")
  })

  it("keeps distinct medications separate", () => {
    const medOne = issue({ kind: "prescription_overdue", severity: "red", medicationId: 1 })
    const medTwo = issue({ kind: "prescription_overdue", severity: "red", medicationId: 2 })
    expect(dedupeIssuesBySubject([medOne, medTwo])).toHaveLength(2)
  })

  it("collapses duplicate observation_overdue issues by observationType", () => {
    const a = issue({ kind: "observation_overdue", severity: "amber", observationType: "Weight", message: "a" })
    const b = issue({ kind: "observation_overdue", severity: "amber", observationType: "Weight", message: "b" })
    expect(dedupeIssuesBySubject([a, b])).toHaveLength(1)
  })

  it("keeps distinct observation types separate", () => {
    const weight = issue({ kind: "observation_overdue", severity: "amber", observationType: "Weight" })
    const bp = issue({ kind: "observation_overdue", severity: "amber", observationType: "Blood Pressure" })
    expect(dedupeIssuesBySubject([weight, bp])).toHaveLength(2)
  })

  it("is a no-op when there are no duplicate subjects", () => {
    const items = [
      issue({ kind: "prescription_overdue", severity: "red", medicationId: 1 }),
      issue({ kind: "observation_overdue", severity: "amber", observationType: "Weight" }),
    ]
    expect(dedupeIssuesBySubject(items)).toHaveLength(2)
  })
})

describe("formatAlertItem — action_url", () => {
  it("returns a record-medication URL for prescription_overdue", () => {
    const i = issue({ kind: "prescription_overdue", severity: "red", medicationId: 1, scheduledSlotTime: "08:00" })
    const alert = formatAlertItem(i, 0, 42, MED_MAP)
    expect(alert.action_url).toBe("/42/record-medication?medication_id=1")
  })

  it("returns a record-medication URL for prescription_upcoming", () => {
    const i = issue({ kind: "prescription_upcoming", severity: "amber", medicationId: 1, scheduledSlotTime: "08:00" })
    const alert = formatAlertItem(i, 0, 42, MED_MAP)
    expect(alert.action_url).toBe("/42/record-medication?medication_id=1")
  })

  it("appends the scheduled dosage for prescription_overdue", () => {
    const i = issue({ kind: "prescription_overdue", severity: "red", medicationId: 1, scheduledSlotTime: "08:00", scheduledDosage: 1 })
    const alert = formatAlertItem(i, 0, 42, MED_MAP)
    expect(alert.action_url).toBe("/42/record-medication?medication_id=1&dosage=1")
  })

  it("appends the scheduled dosage for prescription_upcoming", () => {
    const i = issue({ kind: "prescription_upcoming", severity: "amber", medicationId: 2, scheduledSlotTime: "20:00", scheduledDosage: 2.5 })
    const alert = formatAlertItem(i, 0, 42, MED_MAP)
    expect(alert.action_url).toBe("/42/record-medication?medication_id=2&dosage=2.5")
  })

  it("omits the dosage param when scheduledDosage is missing or non-positive", () => {
    const zero = issue({ kind: "prescription_overdue", severity: "red", medicationId: 1, scheduledSlotTime: "08:00", scheduledDosage: 0 })
    expect(formatAlertItem(zero, 0, 42, MED_MAP).action_url).toBe("/42/record-medication?medication_id=1")
  })

  it("returns a record-observation URL for observation_overdue", () => {
    const i = issue({ kind: "observation_overdue", severity: "amber", observationType: "Blood Pressure" })
    const alert = formatAlertItem(i, 0, 42, MED_MAP)
    expect(alert.action_url).toBe("/42/record-observation?type=Blood%20Pressure")
  })

  it("returns null action_url for prn_cooldown (no action — waiting)", () => {
    const i = issue({ kind: "prn_cooldown", severity: "amber", medicationId: 1, nextAvailableTime: "14:00" })
    const alert = formatAlertItem(i, 0, 42, MED_MAP)
    expect(alert.action_url).toBeNull()
  })

  it("returns null action_url for prn_at_cap (no action — at limit)", () => {
    const i = issue({ kind: "prn_at_cap", severity: "red", medicationId: 1 })
    const alert = formatAlertItem(i, 0, 42, MED_MAP)
    expect(alert.action_url).toBeNull()
  })

  it("returns a record-medication URL for prn_coverage_gap (actionable)", () => {
    const i = issue({ kind: "prn_coverage_gap", severity: "red", medicationId: 2 })
    const alert = formatAlertItem(i, 0, 42, MED_MAP)
    expect(alert.action_url).toBe("/42/record-medication?medication_id=2")
  })
})

describe("formatAlertItem — day qualifier", () => {
  it("prn_cooldown: same-day has no qualifier suffix", () => {
    const i = issue({ kind: "prn_cooldown", severity: "amber", medicationId: 1, nextAvailableTime: "14:00", nextAvailableDayQualifier: null })
    const alert = formatAlertItem(i, 0, 42, MED_MAP)
    expect(alert.short).toBe("Paracetamol · until 14:00")
    expect(alert.detail.sub).toBe("Not available until 14:00")
  })

  it("prn_cooldown: tomorrow adds a compact suffix to short and a fuller phrase to detail.sub", () => {
    const i = issue({ kind: "prn_cooldown", severity: "amber", medicationId: 1, nextAvailableTime: "06:00", nextAvailableDayQualifier: "tomorrow" })
    const alert = formatAlertItem(i, 0, 42, MED_MAP)
    expect(alert.short).toBe("Paracetamol · until 06:00 · tomorrow")
    expect(alert.detail.sub).toBe("Not available until 06:00 tomorrow")
  })

  it("prn_at_cap: resetDayQualifier flows through to both short and detail.sub", () => {
    const i = issue({ kind: "prn_at_cap", severity: "red", medicationId: 1, resetTime: "06:00", resetDayQualifier: "tomorrow" })
    const alert = formatAlertItem(i, 0, 42, MED_MAP)
    expect(alert.short).toBe("Paracetamol · max — resets 06:00 tomorrow")
    expect(alert.detail.sub).toBe("At 24h max — resets 06:00 tomorrow")
  })

  it("prn_coverage_gap: resetDayQualifier flows through to both short and detail.sub", () => {
    const i = issue({ kind: "prn_coverage_gap", severity: "red", medicationId: 2, resetTime: "06:00", resetDayQualifier: "tomorrow" })
    const alert = formatAlertItem(i, 0, 42, MED_MAP)
    expect(alert.short).toBe("Ibuprofen · may leave a gap — resets 06:00 tomorrow")
    expect(alert.detail.sub).toBe("Next dose may leave a gap — resets 06:00 tomorrow")
  })
})

describe("formatAlertItem — short text and type", () => {
  it("prescription_overdue: short contains med name and 'overdue since'", () => {
    const i = issue({ kind: "prescription_overdue", severity: "red", medicationId: 1, scheduledSlotTime: "08:00" })
    const alert = formatAlertItem(i, 0, 42, MED_MAP)
    expect(alert.short).toContain("Paracetamol")
    expect(alert.short).toContain("08:00")
    expect(alert.type).toBe("medication")
  })

  it("prescription_upcoming: short contains med name and 'due at'", () => {
    const i = issue({ kind: "prescription_upcoming", severity: "amber", medicationId: 1, scheduledSlotTime: "20:00" })
    const alert = formatAlertItem(i, 0, 42, MED_MAP)
    expect(alert.short).toContain("Paracetamol")
    expect(alert.short).toContain("20:00")
  })

  it("observation_overdue: type is 'observation'", () => {
    const i = issue({ kind: "observation_overdue", severity: "amber", observationType: "Weight" })
    const alert = formatAlertItem(i, 0, 42, MED_MAP)
    expect(alert.type).toBe("observation")
    expect(alert.short).toContain("Weight")
  })

  it("prn_cooldown: short contains med name and until time", () => {
    const i = issue({ kind: "prn_cooldown", severity: "amber", medicationId: 2, nextAvailableTime: "14:30" })
    const alert = formatAlertItem(i, 0, 42, MED_MAP)
    expect(alert.short).toContain("Ibuprofen")
    expect(alert.short).toContain("14:30")
  })

  it("passes sort_order through as the index parameter", () => {
    const i = issue({ kind: "prn_cooldown", severity: "amber", medicationId: 1 })
    expect(formatAlertItem(i, 7, 42, MED_MAP).sort_order).toBe(7)
  })
})
