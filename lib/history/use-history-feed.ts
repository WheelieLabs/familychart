// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useState } from "react"
import { dashboardScheduleHeaders } from "@/lib/dashboard/dashboard-client-context"
import type { MedRecord } from "@/lib/medication/medication-history"
import type { DoseMissedSummary } from "@/lib/medication/dose-missed-history"
import type { ObsRecord } from "@/lib/observation/observation-history"
import type { TestResultSummary } from "@/lib/test-results/test-result-history"
import type { SymptomEventSummary } from "@/lib/symptoms/symptom-history"
import { toFeedRows, type FeedRow } from "@/lib/history/feed"

export interface UseHistoryFeedArgs {
  personId: string
  from: string
  to: string
  /** Skip fetching while the owning tab isn't visible (mirrors useMedicationHistory's tab gate). */
  enabled: boolean
  /** Also return symptoms that began before `from` but are still running in the window (the Calendar draws spans). */
  symptomOverlap?: boolean
}

export interface UseHistoryFeedResult {
  rows: FeedRow[]
  loading: boolean
  reload: () => Promise<void>
}

/** Shared unfiltered-range fetch for the Live Feed and Calendar tabs — same call shape the old Date tab used. */
export function useHistoryFeed({ personId, from, to, enabled, symptomOverlap = false }: UseHistoryFeedArgs): UseHistoryFeedResult {
  const [rows, setRows] = useState<FeedRow[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    try {
      const [medRecords, obsRecords, testResults, symptomEvents, doseMissed] = await Promise.all([
        fetch(`/api/records?person_id=${personId}&from=${from}&to=${to}`, {
          headers: dashboardScheduleHeaders(),
        }).then(r => r.json() as Promise<MedRecord[]>),
        fetch(`/api/observations?person_id=${personId}&from=${from}&to=${to}`, {
          headers: dashboardScheduleHeaders(),
        }).then(r => r.json() as Promise<ObsRecord[]>),
        fetch(`/api/test-events?person_id=${personId}&from=${from}&to=${to}`, {
          headers: dashboardScheduleHeaders(),
        }).then(r => r.json() as Promise<TestResultSummary[]>),
        fetch(`/api/symptom-events?person_id=${personId}&from=${from}&to=${to}${symptomOverlap ? "&overlap=1" : ""}`, {
          headers: dashboardScheduleHeaders(),
        }).then(r => r.json() as Promise<SymptomEventSummary[]>),
        fetch(`/api/dose-missed?person_id=${personId}&from=${from}&to=${to}`, {
          headers: dashboardScheduleHeaders(),
        }).then(r => (r.ok ? (r.json() as Promise<DoseMissedSummary[]>) : [])),
      ])
      setRows(toFeedRows(medRecords, obsRecords, testResults, symptomEvents, doseMissed))
    } finally {
      setLoading(false)
    }
  }, [personId, from, to, enabled, symptomOverlap])

  useEffect(() => { void reload() }, [reload])

  return { rows, loading, reload }
}
