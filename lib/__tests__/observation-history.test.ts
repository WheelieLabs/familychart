// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  applyKeysetPage,
  buildBpTableRows,
  chartSeriesForObs,
  convertGoalValue,
  daysAgo,
  displayObsValue,
  useObservationHistory,
  type ObsRecord,
  type ObsSummary,
} from "@/lib/observation/observation-history"

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

describe("useObservationHistory schedule headers", () => {
  const SCHEDULE_HEADER_KEYS = ["X-FC-Client-Now", "X-FC-Tz-Offset", "X-FC-Local-Today", "X-FC-Local-Yesterday"]

  function summary(observation_type: string): ObsSummary {
    return { observation_type, last_recorded: "2025-06-01T10:00:00.000Z", total_count: 1, latest_value: 1, latest_unit: "kg" }
  }

  function observationCalls(fetchMock: ReturnType<typeof vi.fn>) {
    return fetchMock.mock.calls
      .map(([url, init]) => ({ url: String(url), init: init as RequestInit | undefined }))
      .filter(c => c.url.startsWith("/api/observations?") && !c.url.includes("summary=true"))
  }

  function expectScheduleHeaders(call: { init: RequestInit | undefined }) {
    const headers = (call.init?.headers ?? {}) as Record<string, string>
    for (const key of SCHEDULE_HEADER_KEYS) expect(headers[key], key).toBeTruthy()
  }

  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.includes("limit=") ? { rows: [], nextCursor: null } : []),
    }))
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("sends the schedule headers on the unpaginated list request", async () => {
    const { result } = renderHook(() =>
      useObservationHistory({ personId: "1", active: false, todayYmd: "2025-06-02" }),
    )
    act(() => result.current.selectObs(summary("Blood Pressure")))
    await waitFor(() => expect(observationCalls(fetchMock).length).toBeGreaterThan(0))

    const calls = observationCalls(fetchMock)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).not.toContain("limit=")
    expectScheduleHeaders(calls[0]!)
  })

  it("sends the schedule headers on the first paginated page request", async () => {
    const { result } = renderHook(() =>
      useObservationHistory({ personId: "1", active: false, todayYmd: "2025-06-02" }),
    )
    act(() => result.current.selectObs(summary("Weight")))
    await waitFor(() => expect(observationCalls(fetchMock).length).toBeGreaterThan(1))

    const page = observationCalls(fetchMock).find(c => c.url.includes("limit=") && !c.url.includes("cursorTs="))
    expect(page).toBeDefined()
    expectScheduleHeaders(page!)
  })

  it("sends the schedule headers on the chart data request", async () => {
    const { result } = renderHook(() =>
      useObservationHistory({ personId: "1", active: false, todayYmd: "2025-06-02" }),
    )
    act(() => result.current.selectObs(summary("Weight")))
    await waitFor(() => expect(observationCalls(fetchMock).length).toBeGreaterThan(1))

    const chart = observationCalls(fetchMock).find(c => c.url.includes("fields=chart"))
    expect(chart).toBeDefined()
    expectScheduleHeaders(chart!)
  })

  it("sends the schedule headers on the load-more request", async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => {
        if (!url.includes("limit=")) return []
        return url.includes("cursorTs=")
          ? { rows: [], nextCursor: null }
          : { rows: [], nextCursor: { ts: "2025-06-01T10:00:00.000Z", id: 7 } }
      },
    }))
    const { result } = renderHook(() =>
      useObservationHistory({ personId: "1", active: false, todayYmd: "2025-06-02" }),
    )
    act(() => result.current.selectObs(summary("Weight")))
    await waitFor(() => expect(result.current.cursor).not.toBeNull())
    await act(async () => { await result.current.loadMoreRecords() })

    const more = observationCalls(fetchMock).find(c => c.url.includes("cursorTs="))
    expect(more).toBeDefined()
    expectScheduleHeaders(more!)
  })
})
