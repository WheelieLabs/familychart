// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { addCalendarDaysToIsoYmd, localDateAndTimeToUtcIso, localDateToIsoYmd } from "@/lib/datetime"
import { dashboardScheduleHeaders } from "@/lib/dashboard/dashboard-client-context"
import type { DoseMissedSummary } from "@/lib/medication/dose-missed-history"
import type { DoseTiming } from "@/lib/medication/dose-timing-display"
import type { MedicationAdministeredBy } from "@/lib/medication/medication-administered-by"

export interface MedSummary {
  id: number
  name: string
  dosage_unit: string | null
  last_recorded: string
  total_doses: number
}

export interface MedRecord {
  id: number
  medication_name: string
  recorded_at: string
  dosage: number | null
  dosage_unit: string | null
  comments: string | null
  /** How the dose sat against its slot; null when it attached to none, absent for an unscheduled medication. */
  timing?: DoseTiming | null
  /** Who gave the dose — null on historical/imported rows predating this field, treated as "me". */
  administered_by?: MedicationAdministeredBy | null
}

export type RecordsCursor = { ts: string; id: number }

export interface MedRecordDraft {
  date: string
  time: string
  dosage: string
  dosage_unit: string
  comments: string
  administered_by: MedicationAdministeredBy
}

export const MED_HISTORY_PAGE_SIZE = 50

/** One line of a medication's History list: a recorded dose, or a Missed slot with no dose. */
export type MedHistoryRow =
  | { kind: "dose"; record: MedRecord }
  | { kind: "missed"; missed: DoseMissedSummary }

/**
 * Interleaves a medication's Missed slots with its doses, newest first. Doses load in pages, so while
 * more remain (`cursor` set) a Missed slot older than the last loaded dose is held back until its
 * page arrives; that keeps the list in order and every row listed once.
 */
export function mergeMissedIntoRecords(
  records: MedRecord[],
  missed: DoseMissedSummary[],
  cursor: RecordsCursor | null,
): MedHistoryRow[] {
  const lastLoaded = records.length > 0 ? records[records.length - 1].recorded_at : null
  const rows: MedHistoryRow[] = [
    ...records.map((record): MedHistoryRow => ({ kind: "dose", record })),
    ...missed
      .filter(m => !cursor || (lastLoaded !== null && m.recorded_at >= lastLoaded))
      .map((m): MedHistoryRow => ({ kind: "missed", missed: m })),
  ]
  const at = (r: MedHistoryRow) => (r.kind === "dose" ? r.record.recorded_at : r.missed.recorded_at)
  const key = (r: MedHistoryRow) => (r.kind === "dose" ? `dose:${r.record.id}` : r.missed.id)
  return rows.sort((a, b) => (at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : key(a) < key(b) ? 1 : -1))
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

export interface UseMedicationHistoryArgs {
  personId: string
  /** Whether the Medication summary is the one currently visible (gates the summary-list fetch). */
  active: boolean
  todayYmd: string
}

export interface UseMedicationHistoryResult {
  summaries: MedSummary[]
  summaryLoading: boolean
  /** True once the summary list has been fetched at least once (distinguishes "not yet" from "none"). */
  summaryLoaded: boolean
  selectedMed: MedSummary | null
  selectMed: (med: MedSummary | null) => void
  records: MedRecord[]
  /** The selected medication's Missed slots in the date range (all of them, not paged). */
  missed: DoseMissedSummary[]
  recordsLoading: boolean
  cursor: RecordsCursor | null
  loadingMore: boolean
  from: string
  setFrom: (ymd: string) => void
  to: string
  setTo: (ymd: string) => void
  loadRecords: () => Promise<void>
  loadMoreRecords: () => Promise<void>
  saveRecord: (id: number, draft: MedRecordDraft) => Promise<{ clearedPrnPushRequests: number }>
  deleteRecord: (id: number) => Promise<void>
}

export function useMedicationHistory({
  personId,
  active,
  todayYmd,
}: UseMedicationHistoryArgs): UseMedicationHistoryResult {
  const prevTodayRef = useRef(todayYmd)

  const [summaries, setSummaries] = useState<MedSummary[]>([])
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryLoaded, setSummaryLoaded] = useState(false)
  const [selectedMed, setSelectedMed] = useState<MedSummary | null>(null)
  const [records, setRecords] = useState<MedRecord[]>([])
  const [missed, setMissed] = useState<DoseMissedSummary[]>([])
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [cursor, setCursor] = useState<RecordsCursor | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [from, setFrom] = useState(() => daysAgo(30, localDateToIsoYmd(new Date())))
  const [to, setTo] = useState(() => localDateToIsoYmd(new Date()))

  useEffect(() => {
    const prev = prevTodayRef.current
    if (todayYmd !== prev) {
      setTo(t => (t === prev ? todayYmd : t))
      prevTodayRef.current = todayYmd
    }
  }, [todayYmd])

  useEffect(() => {
    if (!active || selectedMed) return
    setSummaryLoading(true)
    fetch(`/api/records?summary=true&person_id=${personId}`)
      .then(r => r.json())
      .then((data: MedSummary[]) => {
        setSummaries(data)
        setSummaryLoading(false)
        setSummaryLoaded(true)
      })
      .catch(() => { setSummaryLoading(false); setSummaryLoaded(true) })
  }, [active, personId, selectedMed])

  const loadRecords = useCallback(async () => {
    if (!selectedMed) return
    setRecordsLoading(true)
    setCursor(null)
    try {
      const [res, missedRes] = await Promise.all([
        fetch(
          `/api/records?person_id=${personId}&medication_id=${selectedMed.id}&from=${from}&to=${to}&limit=${MED_HISTORY_PAGE_SIZE}`,
          { headers: dashboardScheduleHeaders() },
        ),
        fetch(
          `/api/dose-missed?person_id=${personId}&medication_id=${selectedMed.id}&from=${from}&to=${to}`,
          { headers: dashboardScheduleHeaders() },
        ),
      ])
      const data = await res.json() as { rows: MedRecord[]; nextCursor: RecordsCursor | null }
      setMissed(missedRes.ok ? (await missedRes.json() as DoseMissedSummary[]) : [])
      const next = applyKeysetPage([], data, "replace")
      setRecords(next.records)
      setCursor(next.nextCursor)
    } finally {
      setRecordsLoading(false)
    }
  }, [personId, selectedMed, from, to])

  const loadMoreRecords = useCallback(async () => {
    if (!cursor || loadingMore || !selectedMed) return
    setLoadingMore(true)
    try {
      const res = await fetch(
        `/api/records?person_id=${personId}&medication_id=${selectedMed.id}&from=${from}&to=${to}&limit=${MED_HISTORY_PAGE_SIZE}&cursorTs=${encodeURIComponent(cursor.ts)}&cursorId=${cursor.id}`,
        { headers: dashboardScheduleHeaders() },
      )
      const data = await res.json() as { rows: MedRecord[]; nextCursor: RecordsCursor | null }
      setRecords(prev => applyKeysetPage(prev, data, "append").records)
      setCursor(data.nextCursor)
    } finally {
      setLoadingMore(false)
    }
  }, [cursor, loadingMore, selectedMed, personId, from, to])

  useEffect(() => {
    void loadRecords()
  }, [loadRecords])

  function selectMed(med: MedSummary | null) {
    setSelectedMed(med)
    if (!med) {
      setRecords([])
      setMissed([])
      setCursor(null)
    }
  }

  async function saveRecord(id: number, draft: MedRecordDraft): Promise<{ clearedPrnPushRequests: number }> {
    const res = await fetch(`/api/records?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recorded_at: localDateAndTimeToUtcIso(draft.date, draft.time),
        dosage: draft.dosage ? parseFloat(draft.dosage) : null,
        dosage_unit: draft.dosage_unit || null,
        comments: draft.comments || null,
        administered_by: draft.administered_by,
      }),
    })
    let clearedPrnPushRequests = 0
    if (res.ok) {
      const data = await res.json().catch(() => null) as { clearedPrnPushRequests?: number } | null
      clearedPrnPushRequests = data?.clearedPrnPushRequests ?? 0
    }
    void loadRecords()
    return { clearedPrnPushRequests }
  }

  async function deleteRecord(id: number): Promise<void> {
    await fetch(`/api/records?id=${id}`, { method: "DELETE" })
    void loadRecords()
  }

  return {
    summaries,
    summaryLoading,
    summaryLoaded,
    selectedMed,
    selectMed,
    records,
    missed,
    recordsLoading,
    cursor,
    loadingMore,
    from,
    setFrom,
    to,
    setTo,
    loadRecords,
    loadMoreRecords,
    saveRecord,
    deleteRecord,
  }
}
