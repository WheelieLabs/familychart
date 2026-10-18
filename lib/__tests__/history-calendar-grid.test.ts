import { describe, it, expect } from "vitest"
import { monthBounds, shiftMonth, monthLabel, buildCalendarGrid, keyedKinds, capDots, MAX_CELL_DOTS, symptomSpan, MAX_SYMPTOM_LANES } from "@/lib/history/calendar-grid"
import type { FeedRow } from "@/lib/history/feed"
import type { SymptomEventSummary } from "@/lib/symptoms/symptom-history"

function medRow(id: number, recorded_at: string): FeedRow {
  return {
    kind: "medication",
    id: `med:${id}`,
    recorded_at,
    flag: null,
    medication: {
      id, medication_name: "Paracetamol", recorded_at, dosage: 5, dosage_unit: "mL",
      comments: null, timing: null,
    },
  }
}

describe("monthBounds", () => {
  it("returns first/last day for a 30-day month", () => {
    expect(monthBounds("2026-09")).toEqual({ from: "2026-09-01", to: "2026-09-30" })
  })

  it("returns first/last day for February in a leap year", () => {
    expect(monthBounds("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" })
  })
})

describe("shiftMonth", () => {
  it("moves forward within a year", () => {
    expect(shiftMonth("2026-09", 1)).toBe("2026-10")
  })

  it("rolls over into the next year", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01")
  })

  it("rolls back into the previous year", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12")
  })
})

describe("monthLabel", () => {
  it("formats a human label", () => {
    expect(monthLabel("2026-09")).toBe("September 2026")
  })
})

describe("buildCalendarGrid", () => {
  it("fills full Sunday-first weeks around the month", () => {
    const cells = buildCalendarGrid("2026-09", [])
    expect(cells.length % 7).toBe(0)
    expect(cells[0]!.ymd).toBe("2026-08-30") // 1 Sep 2026 is a Tuesday
    expect(cells.some(c => c.ymd === "2026-09-01" && c.inMonth)).toBe(true)
    expect(cells.filter(c => c.inMonth)).toHaveLength(30)
  })

  it("marks days with one kind entry per record, not deduped", () => {
    const rows = [
      medRow(1, "2026-09-05T10:00:00.000Z"),
      medRow(2, "2026-09-05T14:00:00.000Z"),
    ]
    const cells = buildCalendarGrid("2026-09", rows)
    const sep5 = cells.find(c => c.ymd === "2026-09-05")
    expect(sep5?.kinds).toEqual(["medication", "medication"])
  })

  it("leaves days with no rows empty", () => {
    const cells = buildCalendarGrid("2026-09", [])
    expect(cells.every(c => c.kinds.length === 0)).toBe(true)
  })
})

describe("keyedKinds", () => {
  it("gives every dot a unique, stable key even when a day has several records of one kind", () => {
    const keyed = keyedKinds(["medication", "observation", "medication", "medication"])
    expect(keyed).toEqual([
      { kind: "medication", key: "medication-1" },
      { kind: "observation", key: "observation-1" },
      { kind: "medication", key: "medication-2" },
      { kind: "medication", key: "medication-3" },
    ])
    expect(new Set(keyed.map(k => k.key)).size).toBe(keyed.length)
  })

  it("returns nothing for an empty day", () => {
    expect(keyedKinds([])).toEqual([])
  })
})

describe("capDots", () => {
  it("shows every dot when a day fits the cap", () => {
    const { dots, more } = capDots(["medication", "observation"])
    expect(dots.map(d => d.key)).toEqual(["medication-1", "observation-1"])
    expect(more).toBe(0)
  })

  it("caps a dense day and reports how many records are not drawn", () => {
    const kinds = Array.from({ length: MAX_CELL_DOTS + 17 }, () => "medication" as const)
    const { dots, more } = capDots(kinds)
    expect(dots).toHaveLength(MAX_CELL_DOTS)
    expect(more).toBe(17)
  })

  it("returns nothing for an empty day", () => {
    expect(capDots([])).toEqual({ dots: [], more: 0 })
  })
})

function symptomRow(id: number, start: string, o: Partial<SymptomEventSummary> = {}): Extract<FeedRow, { kind: "symptom" }> {
  const symptom: SymptomEventSummary = {
    id, person_id: 1, label: `Symptom ${id}`, start_date: start, end_date: null, severity: 2,
    is_resolved: false, resolved_at: null, notes: null, ...o,
  }
  return { kind: "symptom", id: `symptom:${id}`, recorded_at: symptom.start_date, flag: null, symptom }
}

// Local-noon timestamps so the local calendar day is unambiguous in any timezone.
const at = (ymd: string) => new Date(`${ymd}T12:00:00`).toISOString()

describe("symptomSpan", () => {
  it("runs start to end when there is an end date, resolved or not", () => {
    const s = symptomRow(1, at("2026-09-03"), { end_date: at("2026-09-06") }).symptom
    expect(symptomSpan(s, "2026-09-20")).toEqual({ start: "2026-09-03", end: "2026-09-06" })
  })

  it("runs start to the resolved day when resolved with no end date", () => {
    const s = symptomRow(1, at("2026-09-03"), { is_resolved: true, resolved_at: at("2026-09-08") }).symptom
    expect(symptomSpan(s, "2026-09-20")).toEqual({ start: "2026-09-03", end: "2026-09-08" })
  })

  it("runs an ongoing symptom through today and no further", () => {
    const s = symptomRow(1, at("2026-09-03")).symptom
    expect(symptomSpan(s, "2026-09-10")).toEqual({ start: "2026-09-03", end: "2026-09-10" })
  })

  it("is a single day when start and end fall on one day, or when an ongoing symptom starts today", () => {
    const same = symptomRow(1, at("2026-09-03"), { end_date: at("2026-09-03") }).symptom
    expect(symptomSpan(same, "2026-09-20")).toEqual({ start: "2026-09-03", end: "2026-09-03" })
    const today = symptomRow(2, at("2026-09-10")).symptom
    expect(symptomSpan(today, "2026-09-10")).toEqual({ start: "2026-09-10", end: "2026-09-10" })
  })
})

describe("buildCalendarGrid symptom lines", () => {
  const TODAY = "2026-09-30"
  const cellOf = (cells: ReturnType<typeof buildCalendarGrid>, ymd: string) => cells.find(c => c.ymd === ymd)!

  it("draws one continuous line across every day, with caps only at the true start and end", () => {
    const cells = buildCalendarGrid("2026-09", [symptomRow(1, at("2026-09-03"), { end_date: at("2026-09-06") })], TODAY)
    const days = ["2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"].map(d => cellOf(cells, d).symptomLanes[0])
    expect(days.every(Boolean)).toBe(true)
    expect(days.map(d => d!.isStart)).toEqual([true, false, false, false])
    expect(days.map(d => d!.isEnd)).toEqual([false, false, false, true])
    expect(cellOf(cells, "2026-09-02").symptomLanes[0]).toBeNull()
    expect(cellOf(cells, "2026-09-07").symptomLanes[0]).toBeNull()
  })

  it("does not cap at a week-row wrap", () => {
    // 2026-09-05 is a Saturday and 2026-09-06 the following Sunday.
    const cells = buildCalendarGrid("2026-09", [symptomRow(1, at("2026-09-04"), { end_date: at("2026-09-08") })], TODAY)
    expect(cellOf(cells, "2026-09-05").symptomLanes[0]!.isEnd).toBe(false)
    expect(cellOf(cells, "2026-09-06").symptomLanes[0]!.isStart).toBe(false)
  })

  it("draws no dot for a symptom, and leaves other kinds' dots alone", () => {
    const cells = buildCalendarGrid("2026-09", [
      symptomRow(1, at("2026-09-03"), { end_date: at("2026-09-04") }),
      medRow(1, "2026-09-03T10:00:00.000Z"),
    ], TODAY)
    expect(cellOf(cells, "2026-09-03").kinds).toEqual(["medication"])
  })

  it("stops an ongoing symptom at today", () => {
    const cells = buildCalendarGrid("2026-09", [symptomRow(1, at("2026-09-28"))], TODAY)
    expect(cellOf(cells, "2026-09-30").symptomLanes[0]).toBeTruthy()
    expect(cellOf(cells, "2026-10-01").symptomLanes[0]).toBeNull()
  })

  it("renders a symptom that began in an earlier month in the displayed month, uncapped at the left", () => {
    const cells = buildCalendarGrid("2026-09", [symptomRow(1, at("2026-08-25"), { end_date: at("2026-09-02") })], TODAY)
    expect(cellOf(cells, "2026-08-30").symptomLanes[0]!.isStart).toBe(false)
    expect(cellOf(cells, "2026-09-01").symptomLanes[0]).toBeTruthy()
    expect(cellOf(cells, "2026-09-02").symptomLanes[0]!.isEnd).toBe(true)
  })

  it("stacks overlapping symptoms in separate lanes and reuses a lane once it is free", () => {
    const cells = buildCalendarGrid("2026-09", [
      symptomRow(1, at("2026-09-03"), { end_date: at("2026-09-05") }),
      symptomRow(2, at("2026-09-04"), { end_date: at("2026-09-06") }),
      symptomRow(3, at("2026-09-07"), { end_date: at("2026-09-08") }),
    ], TODAY)
    const d4 = cellOf(cells, "2026-09-04").symptomLanes
    expect(d4.map(l => l?.id)).toEqual([1, 2])
    expect(cellOf(cells, "2026-09-07").symptomLanes.map(l => l?.id)).toEqual([3, undefined])
  })

  it("every cell has the same lane count so lines align across days", () => {
    const cells = buildCalendarGrid("2026-09", [
      symptomRow(1, at("2026-09-03"), { end_date: at("2026-09-05") }),
      symptomRow(2, at("2026-09-04"), { end_date: at("2026-09-06") }),
    ], TODAY)
    expect(new Set(cells.map(c => c.symptomLanes.length)).size).toBe(1)
  })

  it("caps lanes and counts the symptoms it cannot draw on each day", () => {
    const rows = Array.from({ length: MAX_SYMPTOM_LANES + 2 }, (_, i) =>
      symptomRow(i + 1, at("2026-09-03"), { end_date: at("2026-09-04") }))
    const cells = buildCalendarGrid("2026-09", rows, TODAY)
    const day = cellOf(cells, "2026-09-03")
    expect(day.symptomLanes).toHaveLength(MAX_SYMPTOM_LANES)
    expect(day.hiddenSymptoms).toBe(2)
    expect(cellOf(cells, "2026-09-10").hiddenSymptoms).toBe(0)
  })

  it("lists the symptoms on each spanned day for assistive text", () => {
    const cells = buildCalendarGrid("2026-09", [symptomRow(1, at("2026-09-03"), { end_date: at("2026-09-05"), label: "Rash" })], TODAY)
    expect(cellOf(cells, "2026-09-04").symptomLabels).toEqual(["Rash"])
  })

  it("keeps a span intact across the spring-forward and fall-back days", () => {
    // Day strings, not millisecond arithmetic, so DST shifts cannot drop or repeat a day.
    for (const month of ["2026-04", "2026-10", "2026-03", "2026-11"]) {
      const first = `${month}-01`, last = `${month}-28`
      const cells = buildCalendarGrid(month, [symptomRow(1, at(first), { end_date: at(last) })], "2026-12-31")
      const days = cells.filter(c => c.ymd >= first && c.ymd <= last)
      expect(days).toHaveLength(28)
      expect(days.every(c => c.symptomLanes[0]?.id === 1)).toBe(true)
    }
  })
})
