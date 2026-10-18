import { describe, it, expect } from "vitest"
import { toFeedRows, orderDayPanelRows, feedRowTimeText, isDateOnlyKind, feedChipKind, medicationFlag, observationFlag, testResultFlag, symptomFlag } from "@/lib/history/feed"
import type { MedRecord } from "@/lib/medication/medication-history"
import type { ObsRecord } from "@/lib/observation/observation-history"
import type { TestResultSummary } from "@/lib/test-results/test-result-history"
import type { SymptomEventSummary } from "@/lib/symptoms/symptom-history"

function medRow(overrides: Partial<MedRecord> = {}): MedRecord {
  return {
    id: 1,
    medication_name: "Paracetamol",
    recorded_at: "2026-08-01T10:00:00.000Z",
    dosage: 5,
    dosage_unit: "mL",
    comments: null,
    timing: null,
    ...overrides,
  }
}

function obsRow(overrides: Partial<ObsRecord> = {}): ObsRecord {
  return {
    id: 1,
    observation_type: "Weight",
    value: 12.3,
    unit: "kg",
    recorded_at: "2026-08-01T09:00:00.000Z",
    comments: null,
    session_id: null,
    value_label: null,
    ...overrides,
  }
}

describe("medicationFlag", () => {
  it("flags a late dose as amber and says by how much", () => {
    const timing = { result: "late", offsetMinutes: 41, slotHhmm: "12:00" } as const
    expect(medicationFlag(medRow({ timing }))).toEqual({ level: "amber", label: "41 min late" })
  })

  it("flags an early dose with the info tone and says by how much", () => {
    const timing = { result: "early", offsetMinutes: -38, slotHhmm: "16:00" } as const
    expect(medicationFlag(medRow({ timing }))).toEqual({ level: "info", label: "38 min early" })
  })

  it("leaves an On time dose unmarked", () => {
    const timing = { result: "on_time", offsetMinutes: 4, slotHhmm: "08:00" } as const
    expect(medicationFlag(medRow({ timing }))).toBeNull()
  })

  it("is null for a dose with no slot", () => {
    expect(medicationFlag(medRow({ timing: null }))).toBeNull()
    expect(medicationFlag(medRow({}))).toBeNull()
  })
})

describe("observationFlag", () => {
  it("is always null (no native per-record severity scale yet)", () => {
    expect(observationFlag()).toBeNull()
  })
})

function testResultRow(overrides: Partial<TestResultSummary> = {}): TestResultSummary {
  return {
    id: 1,
    person_id: 1,
    test_type: "Blood test",
    name: "Full Blood Count",
    date: "2026-08-01T09:00:00.000Z",
    ordered_by: null,
    notes: null,
    attachment_url: null,
    values: [],
    ...overrides,
  }
}

describe("testResultFlag", () => {
  it("flags amber when any value differs from expected", () => {
    const flag = testResultFlag(testResultRow({
      values: [{ metric_name: "COVID-19 RAT", value_type: "qualitative", numeric_value: null, qualitative_value: "Detected", unit: null, reference_range: null, flag: "differs from expected", limit_qualifier: null }],
    }))
    expect(flag).toEqual({ level: "amber", label: "Differs from expected" })
  })

  it("is null when no value is flagged", () => {
    const flag = testResultFlag(testResultRow({
      values: [{ metric_name: "Haemoglobin", value_type: "numeric", numeric_value: 135, qualitative_value: null, unit: "g/L", reference_range: null, flag: null, limit_qualifier: null }],
    }))
    expect(flag).toBeNull()
  })

  it("is null when there are no structured values", () => {
    expect(testResultFlag(testResultRow({ values: [] }))).toBeNull()
  })
})

function symptomRow(overrides: Partial<SymptomEventSummary> = {}): SymptomEventSummary {
  return {
    id: 1,
    person_id: 1,
    label: "Cough",
    start_date: "2026-08-01T09:00:00.000Z",
    end_date: null,
    severity: 2,
    is_resolved: false,
    resolved_at: null,
    notes: null,
    ...overrides,
  }
}

describe("symptomFlag", () => {
  it("shows severity 1 as a neutral badge, not an alert", () => {
    expect(symptomFlag(symptomRow({ severity: 1 }))).toEqual({ level: "neutral", label: "Severity 1/5" })
  })

  it.each([2, 3])("flags severity %s as amber", severity => {
    expect(symptomFlag(symptomRow({ severity }))).toEqual({ level: "amber", label: `Severity ${severity}/5` })
  })

  it.each([4, 5])("flags severity %s as red", severity => {
    expect(symptomFlag(symptomRow({ severity }))).toEqual({ level: "red", label: `Severity ${severity}/5` })
  })
})

describe("toFeedRows", () => {
  it("tags medication rows with kind, id, and flag", () => {
    const rows = toFeedRows([medRow({ id: 5, timing: { result: "late", offsetMinutes: 41, slotHhmm: "08:00" } })], [])
    expect(rows).toEqual([
      {
        kind: "medication",
        id: "med:5",
        recorded_at: "2026-08-01T10:00:00.000Z",
        flag: { level: "amber", label: "41 min late" },
        medication: medRow({ id: 5, timing: { result: "late", offsetMinutes: 41, slotHhmm: "08:00" } }),
      },
    ])
  })

  it("wraps non-BP observations as a single-kind group", () => {
    const rows = toFeedRows([], [obsRow({ id: 7 })])
    expect(rows).toEqual([
      {
        kind: "observation",
        id: "obs:7",
        recorded_at: "2026-08-01T09:00:00.000Z",
        flag: null,
        observation: { kind: "single", record: obsRow({ id: 7 }) },
      },
    ])
  })

  it("pairs blood pressure sys/dia into one observation-kind row", () => {
    const sys = obsRow({ id: 1, observation_type: "Blood Pressure", value: 120, value_label: "Systolic", session_id: "s1" })
    const dia = obsRow({ id: 2, observation_type: "Blood Pressure", value: 80, value_label: "Diastolic", session_id: "s1" })
    const rows = toFeedRows([], [sys, dia])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.kind).toBe("observation")
    expect(rows[0]!.id).toBe("bp:s1")
    if (rows[0]!.kind === "observation") {
      expect(rows[0]!.observation.kind).toBe("pair")
    }
  })

  it("merges medication and observation rows sorted newest-first", () => {
    const rows = toFeedRows(
      [medRow({ id: 1, recorded_at: "2026-08-01T08:00:00.000Z" })],
      [obsRow({ id: 1, recorded_at: "2026-08-01T12:00:00.000Z" }), obsRow({ id: 2, recorded_at: "2026-08-01T06:00:00.000Z" })],
    )
    expect(rows.map(r => r.id)).toEqual(["obs:1", "med:1", "obs:2"])
  })

  it("tags test-result rows with kind, id, and flag, merged into the sorted feed", () => {
    const rows = toFeedRows(
      [medRow({ id: 1, recorded_at: "2026-08-01T08:00:00.000Z" })],
      [],
      [testResultRow({ id: 9, date: "2026-08-01T10:00:00.000Z" })],
    )
    // A test result trails the day's other records even though it is the newer entry.
    expect(rows.map(r => r.id)).toEqual(["med:1", "test:9"])
    expect(rows[1]).toEqual({
      kind: "test_result",
      id: "test:9",
      recorded_at: "2026-08-01T10:00:00.000Z",
      flag: null,
      testResult: testResultRow({ id: 9, date: "2026-08-01T10:00:00.000Z" }),
    })
  })

  it("tags symptom rows with kind, id, and flag, merged into the sorted feed", () => {
    const rows = toFeedRows(
      [medRow({ id: 1, recorded_at: "2026-08-01T08:00:00.000Z" })],
      [],
      [],
      [symptomRow({ id: 3, start_date: "2026-08-01T10:00:00.000Z", severity: 5 })],
    )
    expect(rows.map(r => r.id)).toEqual(["symptom:3", "med:1"])
    expect(rows[0]).toEqual({
      kind: "symptom",
      id: "symptom:3",
      recorded_at: "2026-08-01T10:00:00.000Z",
      flag: { level: "red", label: "Severity 5/5" },
      symptom: symptomRow({ id: 3, start_date: "2026-08-01T10:00:00.000Z", severity: 5 }),
    })
  })
})

describe("confirmed-missed external doses", () => {
  const missed = { id: "slot:4", person_id: 1, medication_name: "Ritalin", recorded_at: "2026-08-01T02:00:00.000Z", cause: "timed_out" as const }

  it("appear in the feed in time order, with no flag", () => {
    const rows = toFeedRows(
      [medRow({ id: 1, recorded_at: "2026-08-01T08:00:00.000Z" })],
      [],
      [],
      [],
      [missed],
    )
    expect(rows.map(r => r.id)).toEqual(["med:1", "dose-missed:slot:4"])
    expect(rows[1]).toEqual({
      kind: "dose_missed",
      id: "dose-missed:slot:4",
      recorded_at: missed.recorded_at,
      flag: null,
      doseMissed: missed,
    })
  })

  it("share the Medication chip so no fifth filter is needed", () => {
    expect(feedChipKind("dose_missed")).toBe("medication")
    expect(feedChipKind("symptom")).toBe("symptom")
  })
})

describe("order within a day", () => {
  // Local-noon timestamps keep each fixture on one local day whatever the machine's timezone.
  const at = (day: number, hour: number) => new Date(2026, 7, day, hour).toISOString()

  it("puts symptoms first and test results last, with the day's other records between, newest day first", () => {
    const rows = toFeedRows(
      [medRow({ id: 1, recorded_at: at(2, 9) }), medRow({ id: 2, recorded_at: at(2, 15) })],
      [obsRow({ id: 5, recorded_at: at(2, 12) })],
      [testResultRow({ id: 9, date: at(2, 17) }), testResultRow({ id: 8, date: at(1, 12) })],
      [symptomRow({ id: 3, start_date: at(2, 0) }), symptomRow({ id: 4, start_date: at(1, 0) })],
    )
    expect(rows.map(r => r.id)).toEqual([
      "symptom:3", "med:2", "obs:5", "med:1", "test:9",
      "symptom:4", "test:8",
    ])
  })

  it("keeps equal rows in a stable order, by id", () => {
    const rows = toFeedRows([
      medRow({ id: 1, recorded_at: at(2, 9) }),
      medRow({ id: 2, recorded_at: at(2, 9) }),
    ], [])
    expect(rows.map(r => r.id)).toEqual(["med:2", "med:1"])
  })

  it("orders a single day's panel with symptoms first and test results last, otherwise feed order", () => {
    const rows = toFeedRows(
      [medRow({ id: 1, recorded_at: at(2, 9) })],
      [],
      [testResultRow({ id: 9, date: at(2, 17) })],
      [symptomRow({ id: 3, start_date: at(1, 0) })],
    )
    // The feed leaves the earlier-starting symptom at the bottom; the panel lifts it to the top.
    expect(rows.map(r => r.id)).toEqual(["med:1", "test:9", "symptom:3"])
    expect(orderDayPanelRows(rows).map(r => r.id)).toEqual(["symptom:3", "med:1", "test:9"])
  })
})

describe("date-only kinds never show a time of day", () => {
  const format = () => "12:00 AM"
  it("prints no time for a symptom or a test result", () => {
    const [symptom] = toFeedRows([], [], [], [symptomRow({ id: 3, start_date: "2026-08-01T00:00:00.000Z" })])
    const [test] = toFeedRows([], [], [testResultRow({ id: 9, date: "2026-08-01T12:00:00.000Z" })])
    expect(feedRowTimeText(symptom!, format)).toBeNull()
    expect(feedRowTimeText(test!, format)).toBeNull()
    expect(isDateOnlyKind("symptom")).toBe(true)
  })

  it("keeps the time on medications, observations and missed doses", () => {
    const [med] = toFeedRows([medRow({ id: 1 })], [])
    expect(feedRowTimeText(med!, format)).toBe("12:00 AM")
    expect(isDateOnlyKind("medication")).toBe(false)
    expect(isDateOnlyKind("observation")).toBe(false)
    expect(isDateOnlyKind("dose_missed")).toBe(false)
  })
})
