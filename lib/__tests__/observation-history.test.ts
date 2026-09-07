// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import {
  applyKeysetPage,
  buildBpTableRows,
  chartSeriesForObs,
  convertGoalValue,
  daysAgo,
  displayObsValue,
  fmtAU,
  type ObsRecord,
} from "@/lib/observation/observation-history"

describe("fmtAU", () => {
  it("formats a local afternoon timestamp as D Mon YYYY h:mm AM/PM", () => {
    const iso = new Date(2024, 0, 5, 14, 5, 0).toISOString()
    expect(fmtAU(iso)).toBe("5 Jan 2024 2:05 PM")
  })
})

describe("daysAgo", () => {
  it("subtracts whole calendar days from an ISO local date", () => {
    expect(daysAgo(90, "2024-03-15")).toBe("2023-12-16")
  })
})

describe("applyKeysetPage", () => {
  const a = { id: 3, recorded_at: "2025-06-01T10:00:00.000Z" }
  const b = { id: 2, recorded_at: "2025-06-01T09:00:00.000Z" }
  const c = { id: 1, recorded_at: "2025-06-01T08:00:00.000Z" }

  it("appends the next page and advances the cursor", () => {
    expect(
      applyKeysetPage([a, b], { rows: [c], nextCursor: null }, "append"),
    ).toEqual({
      records: [a, b, c],
      nextCursor: null,
    })
  })
})

describe("chartSeriesForObs", () => {
  const newestFirst = [
    { recorded_at: "2024-02-02T00:00:00.000Z", value: 80, unit: "kg" },
    { recorded_at: "2024-02-01T00:00:00.000Z", value: 70, unit: "kg" },
  ]

  it("reverses newest-first rows into chronological chart points in the locale unit", () => {
    expect(chartSeriesForObs(newestFirst, "Weight", "metric")).toEqual({
      data: [
        { date: "2024-02-01T00:00:00.000Z", value: 70 },
        { date: "2024-02-02T00:00:00.000Z", value: 80 },
      ],
      unit: "kg",
    })
  })

  it("converts a mixed-unit weight series to imperial pounds", () => {
    expect(chartSeriesForObs(newestFirst, "Weight", "imperial")).toEqual({
      data: [
        { date: "2024-02-01T00:00:00.000Z", value: 154.3 },
        { date: "2024-02-02T00:00:00.000Z", value: 176.4 },
      ],
      unit: "lb",
    })
  })
})

describe("convertGoalValue", () => {
  it("converts a stored goal into the chart display unit", () => {
    expect(convertGoalValue(70, "kg", "Weight", "lb")).toBe(154.3)
  })

  it("returns the original goal when unit conversion is not possible", () => {
    expect(convertGoalValue(80, "bpm", "Heart Rate", "bpm")).toBe(80)
    expect(convertGoalValue(undefined, "kg", "Weight", "lb")).toBeUndefined()
    expect(convertGoalValue(70, null, "Weight", "lb")).toBe(70)
  })
})

describe("displayObsValue", () => {
  it("rounds a stored weight into the locale canonical unit", () => {
    expect(displayObsValue(154.32, "lb", "Weight", "metric")).toEqual({ value: 70, unit: "kg" })
  })
})

describe("buildBpTableRows", () => {
  it("keeps a session-paired systolic/diastolic pair on one row", () => {
    const records: ObsRecord[] = [
      {
        id: 1,
        observation_type: "Blood Pressure",
        value: 120,
        unit: "mmHg",
        recorded_at: "2024-02-01T10:00:00.000Z",
        comments: "ok",
        session_id: "s1",
        value_label: "Systolic",
      },
      {
        id: 2,
        observation_type: "Blood Pressure",
        value: 80,
        unit: "mmHg",
        recorded_at: "2024-02-01T10:00:00.000Z",
        comments: null,
        session_id: "s1",
        value_label: "Diastolic",
      },
    ]
    const rows = buildBpTableRows(records)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: "pair",
      session_id: "s1",
      sys: { id: 1, value: 120 },
      dia: { id: 2, value: 80 },
    })
  })
})
