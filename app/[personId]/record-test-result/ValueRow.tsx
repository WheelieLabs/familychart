// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useState } from "react"
import Button from "@/components/ui/Button"
import EntityRowActions from "@/components/ui/EntityRowActions"
import ValueFields from "./ValueFields"
import type { ValueDraft } from "./value-draft"

interface ValueRowProps {
  draft: ValueDraft
  onChange: (patch: Partial<ValueDraft>) => void
  onRemove: () => void
  /** A value just added by hand opens for editing; a confirmed or saved one starts as a summary. */
  startEditing?: boolean
}

/** "< 5 umol/L", "62 ug/L" or the words of a qualitative result. */
export function valueSummary(d: ValueDraft): string {
  if (d.value_type === "qualitative") return d.qualitative_value || "no result"
  const value = d.numeric_value === "" ? "no value" : `${d.limit_qualifier}${d.limit_qualifier ? " " : ""}${d.numeric_value}`
  return d.unit ? `${value} ${d.unit}` : value
}

/**
 * One value on the result. Confirmed values are a read-only summary until Edit is pressed; Done folds
 * the row back to the summary. The reference range is transcribed from the report, never derived.
 */
export default function ValueRow({ draft, onChange, onRemove, startEditing = false }: ValueRowProps) {
  const [editing, setEditing] = useState(startEditing)
  const rangeLine = draft.reference_range ? `range (${draft.reference_range})` : "no range entered"
  const title = draft.metric_name.trim() || "Custom test"

  return (
    <div className="fc-subform">
      <div className="fc-value-row__head">
        <span className="fc-value-row__title">
          {title}
          {draft.flagged && <span className="fc-value-row__flag"> · differs from expected</span>}
        </span>
        <EntityRowActions
          name={title}
          onEdit={editing ? undefined : () => setEditing(true)}
          onDelete={onRemove}
          deleteLabel="Remove"
        />
      </div>

      {editing ? (
        <>
          <ValueFields draft={draft} onChange={onChange} />
          <div className="fc-actions-end">
            <Button variant="secondary" aria-label={`Done editing ${title}`} onClick={() => setEditing(false)}>Done</Button>
          </div>
        </>
      ) : (
        <>
          <p className="fc-value-row__summary">{valueSummary(draft)}</p>
          <p className="fc-field__hint">{rangeLine}</p>
        </>
      )}
    </div>
  )
}
