// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { addCalendarDaysToIsoYmd, localDateAndTimeToUtcIso, localDateToIsoYmd } from "@/lib/datetime"
import { dashboardScheduleHeaders } from "@/lib/dashboard/dashboard-client-context"
import { groupBpRows, formatBpSingle as formatBpSingleShared, type BpGroupedRow } from "@/lib/blood-pressure-pairing"
import {
  convertObservationValue,
  roundDisplayObservationValue,
  toDisplayObservation,
} from "@/lib/observation/observation-unit-conversion"
import { canonicalUnitForObservationType } from "@/lib/observation/observation-types"
import type { ObservationTypeConfig } from "@/lib/domain-types"
import type { MeasurementSystem } from "@/lib/settings/registry"

export interface ObsSummary {
  observation_type: string
  last_recorded: string
  total_count: number
  latest_value: number | string
  latest_unit: string
}

export interface ObsRecord {
  id: number
  observation_type: string
  value: number
  unit: string
  recorded_at: string
  comments: string | null
  session_id: string | null
  value_label: string | null
}

export type BpDetailRow = BpGroupedRow<ObsRecord>

export type RecordsCursor = { ts: string; id: number }

export interface ObsRecordDraft {
  date: string
  time: string
  value: string
  unit: string
  comments: string
  observation_type: string
}

export interface BpPairDraft {
  date: string
  time: string
  systolic: string
  diastolic: string
  comments: string
  sysId: number
  diaId: number | null
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export const OBS_HISTORY_PAGE_SIZE = 50

export const OBS_HISTORY_CHART_TYPES = new Set([
  "Weight", "Height", "Temperature",
  "Blood Pressure Systolic", "Blood Pressure Diastolic",
  "Heart Rate", "SpO2", "Blood Glucose",
  "Respirations", "Head Circumference",
])

export function fmtAU(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours()
  const hour = h % 12 || 12
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${hour}:${d.getMinutes().toString().padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`
}

export function daysAgo(n: number, fromYmd: string): string {
  return addCalendarDaysToIsoYmd(fromYmd, -n)
}

export function applyKeysetPage<T>(
  current: T[],
  page: { rows: T[]; nextCursor: RecordsCursor | null },
  mode: "replace" | "append",
): { records: T[]; nextCursor: RecordsCursor | null } {
  return {
    records: mode === "append" ? [...current, ...page.rows] : page.rows,
    nextCursor: page.nextCursor,
  }
}

export function isPaginatedObsType(t: string): boolean {
  return t !== "Blood Pressure"
}

export function observationHasChart(type: string): boolean {
  return OBS_HISTORY_CHART_TYPES.has(type) || type === "Hydration" || type === "Blood Pressure"
}

export function displayObsValue(
  value: number,
  unit: string,
  observationType: string,
  measurementSystem: MeasurementSystem,
): { value: number; unit: string } {
  const shown = toDisplayObservation(value, unit, observationType, measurementSystem)
  return {
    value: roundDisplayObservationValue(shown.value, shown.unit),
    unit: shown.unit,
  }
}

export function chartSeriesForObs(
  rows: { recorded_at: string; value: number; unit: string }[],
  observationType: string,
  measurementSystem: MeasurementSystem,
): { data: { date: string; value: number }[]; unit: string } {
  const target =
    canonicalUnitForObservationType(observationType, measurementSystem)
    ?? rows[0]?.unit
    ?? ""
  const data = [...rows].reverse().map(r => {
    const converted = convertObservationValue(r.value, r.unit, target, observationType)
    return {
      date: r.recorded_at,
      value: roundDisplayObservationValue(converted ?? r.value, target || r.unit),
    }
  })
  return { data, unit: target }
}

export function convertGoalValue(
  goalValue: number | undefined,
  goalUnit: string | null | undefined,
  observationType: string,
  displayUnit: string,
): number | undefined {
  if (goalValue == null || !goalUnit) return goalValue
  const converted = convertObservationValue(goalValue, goalUnit, displayUnit, observationType)
  return converted == null ? goalValue : roundDisplayObservationValue(converted, displayUnit)
}

export function buildBpTableRows(records: ObsRecord[]): BpDetailRow[] {
  return groupBpRows(records, "detail")
}

export function formatBpSingle(r: ObsRecord): string {
  return formatBpSingleShared(r)
}

export interface UseObservationHistoryArgs {
  personId: string
  tab: string
  todayYmd: string
}

export interface UseObservationHistoryResult {
  summaries: ObsSummary[]
  typeConfigs: ObservationTypeConfig[]
  summaryLoading: boolean
  selectedObs: ObsSummary | null
  selectObs: (obs: ObsSummary | null) => void
  records: ObsRecord[]
  recordsLoading: boolean
  cursor: RecordsCursor | null
  loadingMore: boolean
  chartData: { recorded_at: string; value: number; unit: string }[]
  chartLoading: boolean
  from: string
  setFrom: (ymd: string) => void
  to: string
  setTo: (ymd: string) => void
  applyPreset: (days: number) => void
  loadRecords: () => Promise<void>
  loadMoreRecords: () => Promise<void>
  loadChartData: () => Promise<void>
  saveRecord: (id: number, draft: ObsRecordDraft) => Promise<void>
  saveBpPair: (draft: BpPairDraft) => Promise<void>
  deleteRecord: (id: number) => Promise<void>
  deleteBpPair: (sysId: number | null, diaId: number | null) => Promise<void>
}

export function useObservationHistory({
  personId,
  tab,
  todayYmd,
}: UseObservationHistoryArgs): UseObservationHistoryResult {
  const prevTodayRef = useRef(todayYmd)

  const [summaries, setSummaries] = useState<ObsSummary[]>([])
  const [typeConfigs, setTypeConfigs] = useState<ObservationTypeConfig[]>([])
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [selectedObs, setSelectedObs] = useState<ObsSummary | null>(null)
  const [records, setRecords] = useState<ObsRecord[]>([])
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [cursor, setCursor] = useState<RecordsCursor | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [chartData, setChartData] = useState<{ recorded_at: string; value: number; unit: string }[]>([])
  const [chartLoading, setChartLoading] = useState(false)
  const [from, setFrom] = useState(() => daysAgo(90, localDateToIsoYmd(new Date())))
  const [to, setTo] = useState(() => localDateToIsoYmd(new Date()))

  useEffect(() => {
    const prev = prevTodayRef.current
    if (todayYmd !== prev) {
      setTo(t => (t === prev ? todayYmd : t))
      prevTodayRef.current = todayYmd
    }
  }, [todayYmd])

  useEffect(() => {
    if (tab !== "observations" || selectedObs) return
    setSummaryLoading(true)
    Promise.all([
      fetch(`/api/observations?summary=true&person_id=${personId}`),
      fetch("/api/observation-type-config"),
    ])
      .then(async ([summRes, cfgRes]) => {
        let configs: ObservationTypeConfig[] = []
        if (cfgRes.ok) {
          try {
            configs = (await cfgRes.json()) as ObservationTypeConfig[]
          } catch {
            configs = []
          }
        }
        setTypeConfigs(configs)

        if (!summRes.ok) {
          setSummaries([])
          return
        }
        setSummaries((await summRes.json()) as ObsSummary[])
      })
      .catch(() => {
        setSummaries([])
      })
      .finally(() => setSummaryLoading(false))
  }, [tab, personId, selectedObs])

  const loadRecords = useCallback(async () => {
    if (!selectedObs) return
    setRecordsLoading(true)
    setCursor(null)
    try {
      const type = selectedObs.observation_type
      if (!isPaginatedObsType(type)) {
        const res = await fetch(
          `/api/observations?person_id=${personId}&type=${encodeURIComponent(type)}&from=${from}&to=${to}`
        )
        setRecords(await res.json())
      } else {
        const res = await fetch(
          `/api/observations?person_id=${personId}&type=${encodeURIComponent(type)}&from=${from}&to=${to}&limit=${OBS_HISTORY_PAGE_SIZE}`
        )
        const data = await res.json() as { rows: ObsRecord[]; nextCursor: RecordsCursor | null }
        const next = applyKeysetPage([], data, "replace")
        setRecords(next.records)
        setCursor(next.nextCursor)
      }
    } finally {
      setRecordsLoading(false)
    }
  }, [personId, selectedObs, from, to])

  const loadMoreRecords = useCallback(async () => {
    if (!cursor || loadingMore || !selectedObs) return
    setLoadingMore(true)
    try {
      const type = selectedObs.observation_type
      const res = await fetch(
        `/api/observations?person_id=${personId}&type=${encodeURIComponent(type)}&from=${from}&to=${to}&limit=${OBS_HISTORY_PAGE_SIZE}&cursorTs=${encodeURIComponent(cursor.ts)}&cursorId=${cursor.id}`
      )
      const data = await res.json() as { rows: ObsRecord[]; nextCursor: RecordsCursor | null }
      setRecords(prev => applyKeysetPage(prev, data, "append").records)
      setCursor(data.nextCursor)
    } finally {
      setLoadingMore(false)
    }
  }, [cursor, loadingMore, selectedObs, personId, from, to])

  const loadChartData = useCallback(async () => {
    if (!selectedObs) return
    const type = selectedObs.observation_type
    if (!OBS_HISTORY_CHART_TYPES.has(type) && type !== "Hydration") {
      setChartData([])
      return
    }
    setChartLoading(true)
    try {
      const res = await fetch(
        `/api/observations?person_id=${personId}&type=${encodeURIComponent(type)}&from=${from}&to=${to}&fields=chart`
      )
      setChartData(await res.json())
    } finally {
      setChartLoading(false)
    }
  }, [personId, selectedObs, from, to])

  useEffect(() => {
    void loadRecords()
    void loadChartData()
  }, [loadRecords, loadChartData])

  function applyPreset(days: number) {
    setTo(todayYmd)
    setFrom(daysAgo(days, todayYmd))
  }

  function selectObs(obs: ObsSummary | null) {
    setSelectedObs(obs)
    if (!obs) {
      setRecords([])
      setCursor(null)
    }
  }

  async function saveRecord(id: number, draft: ObsRecordDraft): Promise<void> {
    await fetch(`/api/observations?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recorded_at: localDateAndTimeToUtcIso(draft.date, draft.time),
        value: parseFloat(draft.value),
        unit: draft.unit,
        comments: draft.comments || null,
      }),
    })
    void Promise.all([loadRecords(), loadChartData()])
  }

  async function saveBpPair(draft: BpPairDraft): Promise<void> {
    const recorded_at = localDateAndTimeToUtcIso(draft.date, draft.time)
    const patches: Promise<Response>[] = []
    if (draft.sysId) {
      patches.push(fetch(`/api/observations?id=${draft.sysId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recorded_at,
          value: parseFloat(draft.systolic),
          unit: "mmHg",
          comments: draft.comments || null,
        }),
      }))
    }
    if (draft.diaId) {
      patches.push(fetch(`/api/observations?id=${draft.diaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recorded_at,
          value: parseFloat(draft.diastolic),
          unit: "mmHg",
          comments: null,
        }),
      }))
    }
    await Promise.all(patches)
    void Promise.all([loadRecords(), loadChartData()])
  }

  async function deleteRecord(id: number): Promise<void> {
    await fetch(`/api/observations?id=${id}`, { method: "DELETE" })
    void Promise.all([loadRecords(), loadChartData()])
  }

  async function deleteBpPair(sysId: number | null, diaId: number | null): Promise<void> {
    const deletes: Promise<Response>[] = []
    if (sysId) deletes.push(fetch(`/api/observations?id=${sysId}`, { method: "DELETE" }))
    if (diaId) deletes.push(fetch(`/api/observations?id=${diaId}`, { method: "DELETE" }))
    await Promise.all(deletes)
    void Promise.all([loadRecords(), loadChartData()])
  }

  return {
    summaries,
    typeConfigs,
    summaryLoading,
    selectedObs,
    selectObs,
    records,
    recordsLoading,
    cursor,
    loadingMore,
    chartData,
    chartLoading,
    from,
    setFrom,
    to,
    setTo,
    applyPreset,
    loadRecords,
    loadMoreRecords,
    loadChartData,
    saveRecord,
    saveBpPair,
    deleteRecord,
    deleteBpPair,
  }
}
