import { describe, expect, it } from "vitest"
import {
  summariseSymptoms,
  summariseTestResults,
  symptomsForKey,
  testResultsForKey,
} from "@/lib/history/record-summaries"
import type { SymptomEventSummary } from "@/lib/symptoms/symptom-history"
import type { TestResultSummary } from "@/lib/test-results/test-result-history"

function symptom(id: number, label: string, start_date: string): SymptomEventSummary {
  return { id, person_id: 1, label, start_date, end_date: null, severity: 2, is_resolved: false, resolved_at: null, notes: null }
}

function result(id: number, name: string, date: string): TestResultSummary {
  return { id, person_id: 1, test_type: "", name, date, ordered_by: null, notes: null, attachment_url: null, values: [] }
}

describe("summariseSymptoms", () => {
  it("groups by label (case and spacing insensitive) with count and most recent start date", () => {
    const summaries = summariseSymptoms([
      symptom(1, "Cough", "2026-08-01T00:00:00.000Z"),
      symptom(2, "runny nose", "2026-08-05T00:00:00.000Z"),
      symptom(3, " cough ", "2026-08-09T00:00:00.000Z"),
    ])
    expect(summaries).toEqual([
      { key: "cough", label: " cough ".trim(), count: 2, lastDate: "2026-08-09T00:00:00.000Z" },
      { key: "runny nose", label: "runny nose", count: 1, lastDate: "2026-08-05T00:00:00.000Z" },
    ])
  })

  it("uses the label spelling from the most recent record", () => {
    const [s] = summariseSymptoms([symptom(1, "cough", "2026-08-01T00:00:00.000Z"), symptom(2, "Cough", "2026-08-09T00:00:00.000Z")])
    expect(s!.label).toBe("Cough")
  })

  it("returns nothing for no records", () => {
    expect(summariseSymptoms([])).toEqual([])
  })
})

describe("summariseTestResults", () => {
  it("groups results by test name, most recently tested first", () => {
    const summaries = summariseTestResults([
      result(1, "Iron Studies", "2026-07-01T02:00:00.000Z"),
      result(2, "TFT Master Panel", "2026-08-01T02:00:00.000Z"),
      result(3, "iron studies", "2026-06-01T02:00:00.000Z"),
    ])
    expect(summaries.map(s => [s.label, s.count, s.lastDate])).toEqual([
      ["TFT Master Panel", 1, "2026-08-01T02:00:00.000Z"],
      ["Iron Studies", 2, "2026-07-01T02:00:00.000Z"],
    ])
  })
})

describe("records for a selected key", () => {
  it("returns every record in the group, newest first", () => {
    const events = [
      symptom(1, "Cough", "2026-08-01T00:00:00.000Z"),
      symptom(2, "Fever", "2026-08-02T00:00:00.000Z"),
      symptom(3, "cough", "2026-08-09T00:00:00.000Z"),
    ]
    expect(symptomsForKey(events, "cough").map(e => e.id)).toEqual([3, 1])
    const results = [result(1, "FBC", "2026-08-01T02:00:00.000Z"), result(2, "fbc", "2026-09-01T02:00:00.000Z"), result(3, "TFT", "2026-09-02T02:00:00.000Z")]
    expect(testResultsForKey(results, "fbc").map(e => e.id)).toEqual([2, 1])
  })
})
