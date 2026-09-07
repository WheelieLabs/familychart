// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { addCalendarDaysToIsoYmd, localDateAndTimeToUtcIso, localDateToIsoYmd } from "@/lib/datetime"
import { dashboardScheduleHeaders } from "@/lib/dashboard/dashboard-client-context"

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
  scheduled_time?: string | null
  scheduled_late?: boolean | null
}

export type RecordsCursor = { ts: string; id: number }

export interface MedRecordDraft {
  date: string
  time: string
  dosage: string
  dosage_unit: string
  comments: string
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export const MED_HISTORY_PAGE_SIZE = 50

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

export interface UseMedicationHistoryArgs {
  personId: string
  tab: string
  todayYmd: string
}

export interface UseMedicationHistoryResult {
  summaries: MedSummary[]
  summaryLoading: boolean
  selectedMed: MedSummary | null
  selectMed: (med: MedSummary | null) => void
  records: MedRecord[]
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
  tab,
  todayYmd,
}: UseMedicationHistoryArgs): UseMedicationHistoryResult {
  const prevTodayRef = useRef(todayYmd)

  const [summaries, setSummaries] = useState<MedSummary[]>([])
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [selectedMed, setSelectedMed] = useState<MedSummary | null>(null)
  const [records, setRecords] = useState<MedRecord[]>([])
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
    if (tab !== "medication" || selectedMed) return
    setSummaryLoading(true)
    fetch(`/api/records?summary=true&person_id=${personId}`)
      .then(r => r.json())
      .then((data: MedSummary[]) => {
        setSummaries(data)
        setSummaryLoading(false)
      })
      .catch(() => setSummaryLoading(false))
  }, [tab, personId, selectedMed])

  const loadRecords = useCallback(async () => {
    if (!selectedMed) return
    setRecordsLoading(true)
    setCursor(null)
    try {
      const res = await fetch(
        `/api/records?person_id=${personId}&medication_id=${selectedMed.id}&from=${from}&to=${to}&limit=${MED_HISTORY_PAGE_SIZE}`,
        { headers: dashboardScheduleHeaders() },
      )
      const data = await res.json() as { rows: MedRecord[]; nextCursor: RecordsCursor | null }
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
    selectedMed,
    selectMed,
    records,
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
