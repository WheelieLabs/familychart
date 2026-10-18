// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useState } from "react"
import DoseExpectationActions from "@/components/DoseExpectationActions"
import Banner from "@/components/ui/Banner"
import Surface from "@/components/ui/Surface"
import { dashboardScheduleHeaders } from "@/lib/dashboard/dashboard-client-context"
import type { DashboardIssue, DashboardPersonStatus } from "@/lib/dashboard/dashboard-status"

interface Props {
  personId: number
  medicationId: number | null
}

/**
 * Soft interrupt for Record Medication: when this person's medication has a dose still awaiting
 * confirmation as given away from home, say so prominently — but never block the new entry.
 */
export default function PendingExpectationNotice({ personId, medicationId }: Props) {
  const [pending, setPending] = useState<DashboardIssue[]>([])

  const load = useCallback(async (): Promise<void> => {
    if (medicationId == null) {
      setPending([])
      return
    }
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store", headers: dashboardScheduleHeaders() })
      if (!res.ok) return
      const all = (await res.json()) as DashboardPersonStatus[]
      const entry = all.find(p => p.personId === personId)
      setPending(
        (entry?.issues ?? []).filter(i => i.kind === "dose_expectation_pending" && i.medicationId === medicationId),
      )
    } catch {
      /* the notice is advisory; a failed lookup just means no notice */
    }
  }, [personId, medicationId])

  useEffect(() => {
    void load()
  }, [load])

  if (pending.length === 0) return null

  return (
    <div role="status" className="fc-form">
      {pending.map(issue => (
        <Banner key={`${issue.expectation?.expectationId}-${issue.expectation?.ymd}`} kind="warning" lead="Waiting for an answer">
          The {issue.scheduledSlotTime} dose is still waiting to be confirmed as given away from home.
          You can still record this dose.
        </Banner>
      ))}
      {pending.map(issue =>
        issue.expectation ? (
          <Surface key={`actions-${issue.expectation.expectationId}-${issue.expectation.ymd}`} kind="light" className="fc-actions-end">
            <DoseExpectationActions
              expectationId={issue.expectation.expectationId}
              ymd={issue.expectation.ymd}
              onResolved={() => void load()}
            />
          </Surface>
        ) : null,
      )}
    </div>
  )
}
