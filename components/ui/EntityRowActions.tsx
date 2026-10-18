// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import Button from "./Button"

interface EntityRowActionsProps {
  /** The row's name. It makes each button's accessible name unique ("Edit Paracetamol"). */
  name: string
  onEdit?: () => void
  onDelete?: () => void
  editLabel?: string
  deleteLabel?: string
}

/**
 * The Edit and Delete controls at the end of a list row, Default height with 14px text. Delete is a
 * destructive control, so it belongs on a Card or a light surface, never directly on the canvas.
 */
export default function EntityRowActions({
  name,
  onEdit,
  onDelete,
  editLabel = "Edit",
  deleteLabel = "Delete",
}: EntityRowActionsProps) {
  return (
    <div className="fc-entity-actions">
      {onEdit && (
        <Button variant="secondary" onClick={onEdit} aria-label={`${editLabel} ${name}`}>
          {editLabel}
        </Button>
      )}
      {onDelete && (
        <Button variant="destructive" onClick={onDelete} aria-label={`${deleteLabel} ${name}`}>
          {deleteLabel}
        </Button>
      )}
    </div>
  )
}
