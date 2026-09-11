// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useRef, useState } from "react"
import Modal from "@/components/Modal"

const PRN_LINE = "A previous PRN reminder for this medication was also cancelled."

export default function MedicationUnitMismatchModal({
  open,
  medicationName,
  recordedUnit,
  prnCleared,
  isManager,
  onUseAsDefault,
  onCreateVariant,
  onDismiss,
}: {
  open: boolean
  medicationName: string
  recordedUnit: string
  prnCleared: boolean
  isManager: boolean
  onUseAsDefault: () => Promise<void>
  onCreateVariant: (name: string) => Promise<void>
  onDismiss: () => void
}) {
  const [view, setView] = useState<"choices" | "variant-name">("choices")
  const [variantName, setVariantName] = useState("")
  const [running, setRunning] = useState(false)
  const [error, setError] = useState("")
  const confirmRef = useRef<HTMLButtonElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setView("choices")
      setVariantName("")
      setRunning(false)
      setError("")
    }
  }, [open])

  useEffect(() => {
    if (view === "variant-name") {
      setVariantName(`${medicationName} (${recordedUnit})`)
    }
  }, [view, medicationName, recordedUnit])

  async function handleUseAsDefault() {
    setRunning(true)
    setError("")
    try {
      await onUseAsDefault()
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Could not update the default unit. Please try again.")
      setRunning(false)
    }
  }

  async function handleCreateVariant() {
    if (!variantName.trim()) {
      setError("Name is required")
      return
    }
    setRunning(true)
    setError("")
    try {
      await onCreateVariant(variantName.trim())
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Could not create the variant. Please try again.")
      setRunning(false)
    }
  }

  const title = "Unit doesn't match the default"

  return (
    <Modal
      open={open}
      onClose={onDismiss}
      title={title}
      panelClassName="bg-fc-panel rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4 shadow-lg"
      backdropClassName="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      titleClassName="font-bold text-gray-800 text-lg"
      closeOnEscape={!running}
      backdropDismiss={!running}
      initialFocusRef={confirmRef}
    >
      {view === "choices" && (
        <>
          <div className="text-gray-700 text-sm leading-relaxed flex flex-col gap-2">
            {isManager ? (
              <p>
                This dose was saved in <strong>{recordedUnit}</strong>, which doesn’t match{" "}
                <strong>{medicationName}</strong>’s default unit. It won’t count toward this medication’s 24-hour
                total until the mismatch is resolved.
              </p>
            ) : (
              <p>
                The dose is saved. It will not count toward this medication’s 24-hour total because the unit does
                not match the default. A manager can set the default to this unit, or add a separate medication for
                this form, under Management → Medications. A new medication will not move this dose; changing the
                default will.
              </p>
            )}
            {prnCleared && <p>{PRN_LINE}</p>}
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex flex-col gap-2 pt-1">
            {isManager ? (
              <>
                <button
                  ref={confirmRef}
                  type="button"
                  onClick={() => void handleUseAsDefault()}
                  disabled={running}
                  className="w-full bg-fc-blue hover:bg-fc-blue-mid text-white font-bold rounded-xl py-3 disabled:opacity-50"
                >
                  {running ? "…" : `Use ${recordedUnit} as the default unit`}
                </button>
                <button
                  type="button"
                  onClick={() => setView("variant-name")}
                  disabled={running}
                  className="w-full border border-gray-400 rounded-xl py-3 text-gray-700 font-bold disabled:opacity-50"
                >
                  Create a variant…
                </button>
                <button
                  type="button"
                  onClick={onDismiss}
                  disabled={running}
                  className="w-full text-gray-500 font-medium py-2 disabled:opacity-50"
                >
                  Leave as-is
                </button>
              </>
            ) : (
              <button
                ref={confirmRef}
                type="button"
                onClick={onDismiss}
                disabled={running}
                className="w-full bg-fc-blue hover:bg-fc-blue-mid text-white font-bold rounded-xl py-3 disabled:opacity-50"
              >
                OK
              </button>
            )}
          </div>
        </>
      )}

      {view === "variant-name" && (
        <>
          <div className="text-gray-700 text-sm leading-relaxed">
            Creates a new catalogue medication using <strong>{recordedUnit}</strong> as its unit, and moves just this
            saved dose onto it. Other history for {medicationName} is unaffected.
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-700">Name</span>
            <input
              ref={nameInputRef}
              type="text"
              value={variantName}
              onChange={e => setVariantName(e.target.value)}
              disabled={running}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => {
                setView("choices")
                setError("")
              }}
              disabled={running}
              className="flex-1 border border-gray-400 rounded-xl py-3 text-gray-700 font-bold disabled:opacity-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => void handleCreateVariant()}
              disabled={running}
              className="flex-1 bg-fc-blue hover:bg-fc-blue-mid text-white font-bold rounded-xl py-3 disabled:opacity-50"
            >
              {running ? "…" : "Create"}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
