// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import {
  buildScheduledMedicationIssues,
  buildPrnFrequencyIssues,
  buildObservationIssues,
  buildPendingDoseExpectationIssues,
  buildOpenSymptomIssues,
  type DashboardIssueScheduleContext,
} from "@/lib/dashboard/dashboard-issue-builders"
import type { AlertReadiness, OverdueObservationFact, PendingDoseExpectationFact, PrnFrequencyFact, ScheduledSlotFact } from "@/lib/alert-readiness"
import type { Person } from "@/lib/domain-types"

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: 1,
    name: "Test",
    full_name: null,
    photo_url: null,
    color: "#000",
    sort_order: 0,
    is_active: 1,
    account_uid: null,
    date_of_birth: null,
    ...overrides,
  }
}

function emptyFacts(overrides: Partial<AlertReadiness> = {}): AlertReadiness {
  return {
    scheduledSlots: [],
    prnBlockedSlots: [],
    prnFlags: [],
    overdueObservations: [],
    pendingDoseExpectations: [],
    ...overrides,
  }
}

function slot(overrides: Partial<ScheduledSlotFact> = {}): ScheduledSlotFact {
  return {
    personId: 1,
    personName: "Test",
    personMedicationId: 1,
    medicationId: 1,
    medicationName: "Paracetamol",
    ymd: "2025-01-15",
    hhmm: "10:00",
    scheduledTime: "10:00",
    scheduledDosage: 1,
    status: "due",
    ...overrides,
  }
}

function prnFlag(overrides: Partial<PrnFrequencyFact> = {}): PrnFrequencyFact {
  return {
    personId: 1,
    personName: "Test",
    medicationId: 1,
    medicationName: "Paracetamol",
    atCap: false,
    cooldown: false,
    coverageGap: false,
    remindAfterDue: false,
    canDose: true,
    resetAtMs: null,
    availableAtMs: null,
    remindAfterRecordIds: [],
    ...overrides,
  }
}

function obs(overrides: Partial<OverdueObservationFact> = {}): OverdueObservationFact {
  return {
    personId: 1,
    personName: "Test",
    expectationId: 1,
    observationType: "weight",
    localYmd: "2025-06-15",
    ...overrides,
  }
}

function schedCtx(now: Date): DashboardIssueScheduleContext {
  return {
    now,
    tzOffsetMinutes: 0,
    localYesterdayYmd: "2025-01-14",
    localTodayYmd: "2025-01-15",
    localTomorrowYmd: "2025-01-16",
  }
}

describe("buildScheduledMedicationIssues", () => {
  it("maps an upcoming slot to a prescription_upcoming issue", () => {
    const facts = emptyFacts({ scheduledSlots: [slot({ status: "upcoming" })] })
    expect(buildScheduledMedicationIssues(person(), facts)).toEqual([
      expect.objectContaining({
        kind: "prescription_upcoming",
        severity: "amber",
        medicationId: 1,
        scheduledSlotTime: "10:00",
      }),
    ])
  })

  it("maps due and overdue slots to prescription_overdue issues", () => {
    const facts = emptyFacts({
      scheduledSlots: [slot({ status: "due" }), slot({ personMedicationId: 2, hhmm: "11:00", scheduledTime: "11:00", status: "overdue" })],
    })
    expect(buildScheduledMedicationIssues(person(), facts)).toEqual([
      expect.objectContaining({ kind: "prescription_overdue", scheduledSlotTime: "10:00" }),
      expect.objectContaining({ kind: "prescription_overdue", scheduledSlotTime: "11:00" }),
    ])
  })

  it("only returns issues for the given person", () => {
    const facts = emptyFacts({ scheduledSlots: [slot({ personId: 2 })] })
    expect(buildScheduledMedicationIssues(person({ id: 1 }), facts)).toEqual([])
  })

  it("does not map PRN-blocked slots into scheduled issues", () => {
    const facts = emptyFacts({ prnBlockedSlots: [slot()] })
    expect(buildScheduledMedicationIssues(person(), facts)).toEqual([])
  })
})

describe("buildPrnFrequencyIssues", () => {
  const now = new Date("2025-01-15T12:00:00.000Z")

  it("reports prn_at_cap when the flag is set", () => {
    const facts = emptyFacts({
      prnFlags: [prnFlag({ atCap: true, canDose: false, resetAtMs: Date.parse("2025-01-15T08:00:00.000Z") + 24 * 3_600_000 })],
    })
    expect(buildPrnFrequencyIssues(person(), facts, schedCtx(now))).toEqual([
      expect.objectContaining({ kind: "prn_at_cap", severity: "red", medicationId: 1 }),
    ])
  })

  it("reports prn_cooldown when the flag is set", () => {
    const facts = emptyFacts({
      prnFlags: [
        prnFlag({
          cooldown: true,
          canDose: false,
          availableAtMs: Date.parse("2025-01-15T15:00:00.000Z"),
        }),
      ],
    })
    expect(buildPrnFrequencyIssues(person(), facts, schedCtx(now))).toEqual([
      expect.objectContaining({ kind: "prn_cooldown", severity: "amber", medicationId: 1 }),
    ])
  })

  it("reports nothing when flags are alert-clear", () => {
    const facts = emptyFacts({ prnFlags: [prnFlag({ canDose: true })] })
    expect(buildPrnFrequencyIssues(person(), facts, schedCtx(now))).toEqual([])
  })

  it("suppresses prn_coverage_gap while still in cooldown from the prior dose", () => {
    const facts = emptyFacts({
      prnFlags: [
        prnFlag({
          coverageGap: true,
          cooldown: true,
          canDose: false,
          availableAtMs: Date.parse("2025-01-15T15:00:00.000Z"),
        }),
      ],
    })
    expect(buildPrnFrequencyIssues(person(), facts, schedCtx(now))).toEqual([
      expect.objectContaining({ kind: "prn_cooldown", severity: "amber", medicationId: 1 }),
    ])
  })

  it("reports prn_coverage_gap once cooldown has cleared", () => {
    const facts = emptyFacts({
      prnFlags: [
        prnFlag({
          coverageGap: true,
          cooldown: false,
          canDose: true,
          resetAtMs: Date.parse("2025-01-15T08:00:00.000Z") + 24 * 3_600_000,
        }),
      ],
    })
    expect(buildPrnFrequencyIssues(person(), facts, schedCtx(now))).toEqual([
      expect.objectContaining({ kind: "prn_coverage_gap", severity: "red", medicationId: 1 }),
    ])
  })
})

describe("buildObservationIssues", () => {
  it("maps overdue observation facts to observation_overdue issues", () => {
    expect(buildObservationIssues(person(), emptyFacts({ overdueObservations: [obs()] }))).toEqual([
      expect.objectContaining({ kind: "observation_overdue", observationType: "weight" }),
    ])
  })

  it("only reports facts belonging to the given person", () => {
    expect(
      buildObservationIssues(person({ id: 1 }), emptyFacts({ overdueObservations: [obs({ personId: 2 })] })),
    ).toEqual([])
  })
})

describe("buildPendingDoseExpectationIssues", () => {
  const fact: PendingDoseExpectationFact = {
    personId: 1,
    personName: "Test",
    personMedicationId: 3,
    medicationId: 5,
    medicationName: "Methylphenidate",
    expectationId: 9,
    ymd: "2025-01-15",
    hhmm: "12:00",
    slotMs: Date.UTC(2025, 0, 15, 12, 0),
    scheduledDosage: 1,
  }

  it("emits one neutral amber issue per pending expectation for the person", () => {
    const issues = buildPendingDoseExpectationIssues(person(), emptyFacts({ pendingDoseExpectations: [fact] }))
    expect(issues).toEqual([
      {
        kind: "dose_expectation_pending",
        severity: "amber",
        message: "Methylphenidate — was the 12:00 dose given away from home?",
        medicationId: 5,
        scheduledSlotTime: "12:00",
        scheduledDosage: 1,
        expectation: { expectationId: 9, ymd: "2025-01-15" },
      },
    ])
  })

  it("ignores other people's expectations", () => {
    expect(
      buildPendingDoseExpectationIssues(person(), emptyFacts({ pendingDoseExpectations: [{ ...fact, personId: 2 }] })),
    ).toEqual([])
  })
})

describe("buildOpenSymptomIssues", () => {
  const prompts = [
    { symptomId: 1, personId: 1, label: "Headache", startYmd: "2026-10-02" },
    { symptomId: 2, personId: 1, label: "Cough", startYmd: "2026-10-01" },
    { symptomId: 3, personId: 2, label: "Rash", startYmd: "2026-10-01" },
  ]

  it("makes one notice per open symptom for that person only", () => {
    const issues = buildOpenSymptomIssues(person({ id: 1 }), prompts)
    expect(issues.map(i => i.symptom?.symptomId)).toEqual([1, 2])
    expect(issues.every(i => i.kind === "symptom_open_pending" && i.severity === "notice")).toBe(true)
    expect(issues[0]!.message).toBe("Headache — open since 2 Oct: still ongoing?")
  })

  it("makes none for a person with no open symptoms", () => {
    expect(buildOpenSymptomIssues(person({ id: 9 }), prompts)).toEqual([])
  })
})
