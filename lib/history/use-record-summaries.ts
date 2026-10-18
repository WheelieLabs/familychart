// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useState } from "react"
import { dashboardScheduleHeaders } from "@/lib/dashboard/dashboard-client-context"
import type { SymptomEventSummary } from "@/lib/symptoms/symptom-history"
import type { TestResultSummary } from "@/lib/test-results/test-result-history"

export interface UseRecordSummariesResult {
  symptoms: SymptomEventSummary[]
  testResults: TestResultSummary[]
  loading: boolean
  /** True once the lists have been fetched at least once. */
  loaded: boolean
  reload: () => Promise<void>
}

/**
 * Every symptom and test result for the person (no date range), for the History > Summaries pills.
 * Only fetches while one of those pills is showing.
 */
export function useRecordSummaries({ personId, enabled }: { personId: string; enabled: boolean }): UseRecordSummariesResult {
  const [symptoms, setSymptoms] = useState<SymptomEventSummary[]>([])
  const [testResults, setTestResults] = useState<TestResultSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    try {
      const [symptomRows, testRows] = await Promise.all([
        fetch(`/api/symptom-events?person_id=${personId}`, { headers: dashboardScheduleHeaders() })
          .then(r => (r.ok ? (r.json() as Promise<SymptomEventSummary[]>) : [])),
        fetch(`/api/test-events?person_id=${personId}`, { headers: dashboardScheduleHeaders() })
          .then(r => (r.ok ? (r.json() as Promise<TestResultSummary[]>) : [])),
      ])
      setSymptoms(symptomRows)
      setTestResults(testRows)
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }, [personId, enabled])

  useEffect(() => { void reload() }, [reload])

  return { symptoms, testResults, loading, loaded, reload }
}
