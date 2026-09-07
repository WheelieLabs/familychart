// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import Modal from "@/components/Modal"

export type ConfirmVariant = "danger" | "warning" | "primary"

const confirmButtonClass: Record<ConfirmVariant, string> = {
  danger: "bg-red-600 hover:bg-red-700 text-white disabled:opacity-50",
  warning: "bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50",
  primary: "bg-fc-blue hover:bg-fc-blue-mid text-white disabled:opacity-50",
}

export const confirmCopy = {
  deleteMedicationRecord: {
    variant: "danger" as const,
    title: "Delete medication record?",
    message:
      "This removes one dose entry from this person's history. The medication stays in the catalogue; only this logged dose is removed. This cannot be undone.",
    confirmLabel: "Delete",
  },
  deleteObservation: {
    variant: "danger" as const,
    title: "Delete this observation?",
    message:
      "This removes a single measurement from history (for example weight, temperature, or a standalone BP row). It cannot be undone.",
    confirmLabel: "Delete",
  },
  deleteBloodPressureReading: {
    variant: "danger" as const,
    title: "Delete this blood pressure reading?",
    message:
      "This removes the paired systolic and diastolic values recorded together from history. It cannot be undone.",
    confirmLabel: "Delete",
  },
  removePersonFromList: {
    variant: "warning" as const,
    title: "Remove this person?",
    message:
      "They will no longer appear in your family list. Medication dose logs and observations already stored for them remain in the database.",
    confirmLabel: "Remove",
  },
  removeMedicationFromPersonSchedule: {
    variant: "warning" as const,
    title: "Remove medication from this list?",
    message:
      "Past doses remain in History. You can assign this medication again from the catalogue anytime.",
    confirmLabel: "Remove",
  },
  prnPushRequestCleared: {
    variant: "primary" as const,
    title: "Reminder cancelled",
    message: "A previous PRN reminder for this medication was cancelled.",
    confirmLabel: "OK",
  },
}

export function removeMedicationConfirmCopy(name: string): {
  variant: "warning"
  title: string
  message: string
  detail: string
  confirmLabel: string
} {
  return {
    variant: "warning",
    title: `Delete “${name}”?`,
    message:
      "The app removes this catalogue entry when no dose history exists and it is not on anyone’s medication list. If it is still in use, it is marked inactive instead.",
    detail:
      "Inactive medications are hidden when recording doses. Use the Active / Inactive control in Edit to show one in search again.",
    confirmLabel: "Delete",
  }
}

export function medicationRemoveResultCopy(
  action: "deactivated" | "deleted",
  name: string,
): {
  variant: ConfirmVariant
  title: string
  message: string
  detail?: string
  confirmLabel: string
} {
  if (action === "deactivated") {
    return {
      variant: "primary",
      title: `“${name}” is now inactive`,
      message:
        "Existing dose history and person assignments are unchanged. This medication is hidden when searching to log new doses.",
      detail: "Open Edit and set status to Active if you want it to appear in Record Medication again.",
      confirmLabel: "OK",
    }
  }
  return {
    variant: "primary",
    title: `“${name}” was removed`,
    message:
      "The medication was permanently removed from the catalogue because it had no logged doses and was not assigned to anyone.",
    confirmLabel: "OK",
  }
}

export function removeObservationTypeConfirmCopy(name: string): {
  variant: "warning"
  title: string
  message: string
  detail: string
  confirmLabel: string
} {
  return {
    variant: "warning",
    title: `Delete “${name}”?`,
    message:
      "The app removes this catalogue entry when no readings or reminder schedules use it. If it is still in use, it is marked inactive instead so existing data stays intact.",
    detail:
      "Inactive types are hidden from recording and new reminder pickers. Use Activate on the row to make one available again.",
    confirmLabel: "Delete",
  }
}

export function observationTypeRemoveResultCopy(
  action: "deactivated" | "deleted",
  name: string,
): {
  variant: ConfirmVariant
  title: string
  message: string
  detail?: string
  confirmLabel: string
} {
  if (action === "deactivated") {
    return {
      variant: "primary",
      title: `“${name}” is now inactive`,
      message:
        "Existing observations and schedules are unchanged. This type is hidden when recording new readings or setting up new reminders.",
      detail: "Use Activate on this row if you want it available again.",
      confirmLabel: "OK",
    }
  }
  return {
    variant: "primary",
    title: `“${name}” was removed`,
    message: "The observation type was permanently removed from the catalogue because nothing referenced it.",
    confirmLabel: "OK",
  }
}

export default function ConfirmModal({
  open,
  title,
  message,
  detail,
  variant,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  showCancel = true,
  backdropZClassName = "z-[100]",
  closeOnEscape = true,
  backdropDismiss = true,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: ReactNode
  detail?: ReactNode
  variant: ConfirmVariant
  confirmLabel?: string
  cancelLabel?: string
  /** When false, only the confirm button is shown (alert-style). */
  showCancel?: boolean
  /** Tailwind stacking class on the fullscreen portal backdrop (above other fixed layers). */
  backdropZClassName?: string
  /** When false, Escape does not call onCancel. */
  closeOnEscape?: boolean
  /** When false, clicking the backdrop does not call onCancel. */
  backdropDismiss?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}) {
  const [running, setRunning] = useState(false)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) setRunning(false)
  }, [open])

  async function handleConfirm() {
    setRunning(true)
    try {
      await Promise.resolve(onConfirm())
    } finally {
      setRunning(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      panelClassName="bg-fc-panel rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4 shadow-lg"
      backdropClassName={`fixed inset-0 ${backdropZClassName} flex items-center justify-center bg-black/60 p-4`}
      titleClassName="font-bold text-gray-800 text-lg"
      closeOnEscape={closeOnEscape}
      backdropDismiss={backdropDismiss}
      initialFocusRef={confirmRef}
    >
      <div className="text-gray-700 text-sm leading-relaxed">{message}</div>
      {detail != null && detail !== "" && (
        <div className="text-gray-600 text-sm leading-relaxed border-t border-gray-200/80 pt-3">
          {detail}
        </div>
      )}
      <div className="flex gap-3 pt-1">
        {showCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={running}
            className="flex-1 border border-gray-400 rounded-xl py-3 text-gray-700 font-bold disabled:opacity-50"
          >
            {cancelLabel}
          </button>
        )}
        <button
          ref={confirmRef}
          type="button"
          onClick={() => void handleConfirm()}
          disabled={running}
          className={`${showCancel ? "flex-1" : "w-full"} font-bold rounded-xl py-3 transition-colors ${confirmButtonClass[variant]}`}
        >
          {running ? "…" : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
