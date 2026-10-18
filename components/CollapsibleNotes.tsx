// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useState } from "react"
import Button from "@/components/ui/Button"
import { Textarea } from "@/components/ui/controls"
import FormField from "@/components/ui/FormField"

interface CollapsibleNotesProps {
  /** Noun used in the toggle and label, e.g. "notes" or "comment". */
  noun: "notes" | "comment"
  value: string
  onChange: (value: string) => void
  rows?: number
}

/**
 * Free text collapsed behind "+ Add notes" / "+ Add comment" (shared Record X form pattern).
 * Starts open when the form already holds text (editing a record that has some); an existing
 * value is never hidden once the carer has opened it.
 */
export default function CollapsibleNotes({ noun, value, onChange, rows = 3 }: CollapsibleNotesProps) {
  const [open, setOpen] = useState(value.trim() !== "")
  const label = noun === "notes" ? "Notes" : "Comment"

  // A value loaded after mount (edit mode fetches the record) opens the field instead of hiding it.
  // Latched in state so clearing the text afterwards doesn't collapse the field mid-edit.
  if (!open && value.trim() !== "") setOpen(true)

  if (!open) {
    return (
      <div>
        <Button variant="quiet" onClick={() => setOpen(true)}>+ Add {noun}</Button>
      </div>
    )
  }

  return (
    <FormField label={label} optional>
      <Textarea value={value} onChange={e => onChange(e.target.value)} rows={rows} />
    </FormField>
  )
}
