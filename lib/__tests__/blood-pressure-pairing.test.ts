import { describe, it, expect } from "vitest"
import {
  groupBpRows,
  latestBpFromRecentRows,
  formatBpSingle,
  type BpObservationRow,
} from "@/lib/blood-pressure-pairing"

function row(overrides: Partial<BpObservationRow> = {}): BpObservationRow {
  return {
    id: 1,
    value: 120,
    unit: "mmHg",
    recorded_at: "2026-08-01T10:00:00.000Z",
    session_id: null,
    value_label: null,
    comments: null,
    ...overrides,
  }
}

describe("groupBpRows", () => {
  it("pairs a complete sys+dia session in detail mode, joining comments", () => {
    const sys = row({ id: 1, value: 120, value_label: "Systolic", session_id: "s1", comments: "felt dizzy" })
    const dia = row({ id: 2, value: 80, value_label: "Diastolic", session_id: "s1", comments: "post-walk" })
    const [g] = groupBpRows([sys, dia], "detail")
    expect(g).toEqual({
      kind: "pair",
      session_id: "s1",
      sys,
      dia,
      recorded_at: sys.recorded_at,
      comments: "felt dizzy — post-walk",
    })
  })

  it("falls back to singles when a session has an extra non-labelled reading (detail mode)", () => {
    const sys = row({ id: 1, value_label: "Systolic", session_id: "s1" })
    const dia = row({ id: 2, value_label: "Diastolic", session_id: "s1" })
    const extra = row({ id: 3, value_label: null, session_id: "s1" })
    const rows = groupBpRows([sys, dia, extra], "detail")
    expect(rows.every(r => r.kind === "single")).toBe(true)
    expect(rows).toHaveLength(3)
  })

  it("pairs sys+dia in summary mode even with a stray extra session reading", () => {
    const sys = row({ id: 1, value_label: "Systolic", session_id: "s1" })
    const dia = row({ id: 2, value_label: "Diastolic", session_id: "s1" })
    const extra = row({ id: 3, value_label: null, session_id: "s1" })
    const rows = groupBpRows([sys, dia, extra], "summary")
    const pair = rows.find(r => r.kind === "pair")
    expect(pair).toBeDefined()
    expect(pair!.kind === "pair" && pair!.comments).toBeNull()
  })

  it("treats legacy unsessioned rows as individual singles", () => {
    const a = row({ id: 1, session_id: null, recorded_at: "2026-08-01T10:00:00.000Z" })
    const b = row({ id: 2, session_id: null, recorded_at: "2026-08-02T10:00:00.000Z" })
    const rows = groupBpRows([a, b], "detail")
    expect(rows).toEqual([
      { kind: "single", record: b },
      { kind: "single", record: a },
    ])
  })

  it("does not merge a comment that is empty on one side", () => {
    const sys = row({ id: 1, value_label: "Systolic", session_id: "s1", comments: "elevated" })
    const dia = row({ id: 2, value_label: "Diastolic", session_id: "s1", comments: null })
    const [g] = groupBpRows([sys, dia], "detail")
    expect(g.kind === "pair" && g.comments).toBe("elevated")
  })

  it("sorts pairs and singles together newest-first", () => {
    const older = row({ id: 1, session_id: null, recorded_at: "2026-08-01T00:00:00.000Z" })
    const sys = row({ id: 2, value_label: "Systolic", session_id: "s1", recorded_at: "2026-08-03T00:00:00.000Z" })
    const dia = row({ id: 3, value_label: "Diastolic", session_id: "s1", recorded_at: "2026-08-03T00:05:00.000Z" })
    const rows = groupBpRows([older, sys, dia], "detail")
    expect(rows.map(r => (r.kind === "pair" ? r.session_id : r.record.id))).toEqual(["s1", 1])
  })
})

describe("latestBpFromRecentRows", () => {
  it("returns null for no records", () => {
    expect(latestBpFromRecentRows([])).toBeNull()
  })

  it("pairs the newest session for display", () => {
    const sys = row({ id: 1, value: 118, value_label: "Systolic", session_id: "s1", recorded_at: "2026-08-03T00:00:00.000Z" })
    const dia = row({ id: 2, value: 76, value_label: "Diastolic", session_id: "s1", recorded_at: "2026-08-03T00:05:00.000Z" })
    const result = latestBpFromRecentRows([dia, sys])
    expect(result).toEqual({
      display: "118/76 mmHg",
      last_recorded: "2026-08-03T00:05:00.000Z",
      latest_unit: "",
    })
  })

  it("falls back to a single formatted value when no partner exists", () => {
    const single = row({ id: 1, value: 130, unit: "mmHg", value_label: "Systolic", session_id: null })
    const result = latestBpFromRecentRows([single])
    expect(result).toEqual({
      display: "Systolic: 130 mmHg",
      last_recorded: single.recorded_at,
      latest_unit: "mmHg",
    })
  })

  it("pairs newest session in summary mode even with a third stray reading", () => {
    const sys = row({ id: 1, value: 118, value_label: "Systolic", session_id: "s1", recorded_at: "2026-08-03T00:00:00.000Z" })
    const dia = row({ id: 2, value: 76, value_label: "Diastolic", session_id: "s1", recorded_at: "2026-08-03T00:05:00.000Z" })
    const extra = row({ id: 3, value_label: null, session_id: "s1", recorded_at: "2026-08-03T00:02:00.000Z" })
    const result = latestBpFromRecentRows([extra, dia, sys])
    expect(result?.display).toBe("118/76 mmHg")
  })
})

describe("formatBpSingle", () => {
  it("includes the label when present", () => {
    expect(formatBpSingle(row({ value: 90, unit: "mmHg", value_label: "Diastolic" }))).toBe("Diastolic: 90 mmHg")
  })

  it("omits the label when absent", () => {
    expect(formatBpSingle(row({ value: 90, unit: "mmHg", value_label: null }))).toBe("90 mmHg")
  })
})
