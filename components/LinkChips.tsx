// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useState } from "react"
import Chip from "@/components/ui/Chip"
import { formatDateTime } from "@/lib/date-format"
import { doseChipLabel, symptomChipLabel } from "@/lib/symptoms/link-editing"
import type { PersonLink } from "@/lib/symptoms/symptom-dose-link-types"

/** On a dose row: which symptom(s) it was for. Tap to expand in place. */
export function DoseSymptomChip({ links }: { links: readonly PersonLink[] }) {
  const [open, setOpen] = useState(false)
  if (links.length === 0) return null
  return (
    <div className="fc-link-chip">
      <Chip kind="disclosure" expanded={open} onExpandedChange={setOpen} emoji="🤒">
        {doseChipLabel(links.map(l => l.symptom_label))}
      </Chip>
      {open && (
        <ul className="fc-link-chip__list">
          {links.map(l => <li key={l.symptom_event_id}>{l.symptom_label}</li>)}
        </ul>
      )}
    </div>
  )
}

/** On a symptom row: how many doses are linked. Tap to expand in place. */
export function SymptomDoseChip({ links }: { links: readonly PersonLink[] }) {
  const [open, setOpen] = useState(false)
  if (links.length === 0) return null
  return (
    <div className="fc-link-chip">
      <Chip kind="disclosure" expanded={open} onExpandedChange={setOpen} emoji="💊">
        {symptomChipLabel(links.length)}
      </Chip>
      {open && (
        <ul className="fc-link-chip__list">
          {links.map(l => <li key={l.medication_record_id}>{l.medication_name} · {formatDateTime(l.recorded_at)}</li>)}
        </ul>
      )}
    </div>
  )
}
