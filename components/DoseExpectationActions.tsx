// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useState } from "react"
import Button from "@/components/ui/Button"
import { disabledWhen } from "@/lib/ui/disabled-props"
import { dashboardScheduleHeaders } from "@/lib/dashboard/dashboard-client-context"
import { closeNotificationsByTag } from "@/lib/push/notification-client"

type Answer = "given" | "missed" | "not_yet"

interface Props {
  expectationId: number
  ymd: string
  onResolved: () => void
}

const LABELS: { answer: Answer; text: string; aria: string }[] = [
  { answer: "given", text: "Yes", aria: "Yes, the dose was given" },
  { answer: "missed", text: "No", aria: "No, the dose was not given" },
  { answer: "not_yet", text: "Not yet", aria: "Not yet — ask again later" },
]

/**
 * Inline yes / no / not-yet resolver for a pending dose expectation (flat buttons extending the
 * existing "Mute today" row). Clicks never bubble, so it is safe inside a clickable list row.
 */
export default function DoseExpectationActions({ expectationId, ymd, onResolved }: Props) {
  const [busy, setBusy] = useState<Answer | null>(null)
  const [error, setError] = useState("")

  async function answer(outcome: Answer): Promise<void> {
    if (busy) return
    setBusy(outcome)
    setError("")
    try {
      const res = await fetch(`/api/dose-expectations/${expectationId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...dashboardScheduleHeaders() },
        body: JSON.stringify({ local_ymd: ymd, outcome }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? "Could not save that answer.")
        return
      }
      const saved = (await res.json().catch(() => null)) as { closeNotificationTag?: string | null } | null
      await closeNotificationsByTag(saved?.closeNotificationTag)
      onResolved()
    } catch {
      setError("Could not save that answer.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fc-expect-actions" onClick={e => e.stopPropagation()}>
      <div className="fc-expect-actions__row">
        {LABELS.map(l => (
          <Button
            key={l.answer}
            variant="secondary"
            aria-label={l.aria}
            pending={busy === l.answer}
            pendingLabel="…"
            onClick={() => void answer(l.answer)}
            {...disabledWhen(busy !== null && busy !== l.answer && "Saving your answer…")}
          >
            {l.text}
          </Button>
        ))}
      </div>
      {error && <span role="alert" className="fc-expect-actions__error">{error}</span>}
    </div>
  )
}
