// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useState } from "react"
import Modal from "@/components/Modal"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import { disabledWhen } from "@/lib/ui/disabled-props"
import { Input } from "@/components/ui/controls"
import FormField from "@/components/ui/FormField"

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
    >
      {view === "choices" && (
        <div className="fc-form">
          <div className="fc-form">
            {isManager ? (
              <p className="fc-section-copy">
                This dose was saved in <strong>{recordedUnit}</strong>, which doesn’t match{" "}
                <strong>{medicationName}</strong>’s default unit. It won’t count toward this medication’s 24-hour
                total until the mismatch is resolved.
              </p>
            ) : (
              <p className="fc-section-copy">
                The dose is saved. It will not count toward this medication’s 24-hour total because the unit does
                not match the default. A manager can set the default to this unit, or add a separate medication for
                this form, under Management → Medications. A new medication will not move this dose; changing the
                default will.
              </p>
            )}
            {prnCleared && <p className="fc-section-copy">{PRN_LINE}</p>}
          </div>

          {error && <Banner kind="error">{error}</Banner>}

          <div className="fc-form">
            {isManager ? (
              <>
                {running ? (
                  <Button disabled disabledReason="Saving…" fullWidth>{`Use ${recordedUnit} as the default unit`}</Button>
                ) : (
                  <Button fullWidth onClick={() => void handleUseAsDefault()}>{`Use ${recordedUnit} as the default unit`}</Button>
                )}
                {running ? (
                  <Button variant="secondary" disabled disabledReason="Saving…" fullWidth>Create a variant…</Button>
                ) : (
                  <Button variant="secondary" fullWidth onClick={() => setView("variant-name")}>Create a variant…</Button>
                )}
                {running ? (
                  <Button variant="quiet" disabled disabledReason="Saving…" fullWidth>Leave as-is</Button>
                ) : (
                  <Button variant="quiet" fullWidth onClick={onDismiss}>Leave as-is</Button>
                )}
              </>
            ) : (
              <Button fullWidth onClick={onDismiss}>OK</Button>
            )}
          </div>
        </div>
      )}

      {view === "variant-name" && (
        <div className="fc-form">
          <p className="fc-section-copy">
            Creates a new catalogue medication using <strong>{recordedUnit}</strong> as its unit, and moves just this
            saved dose onto it. Other history for {medicationName} is unaffected.
          </p>
          <FormField label="Name">
            <Input type="text" value={variantName} onChange={e => setVariantName(e.target.value)} disabled={running} />
          </FormField>

          {error && <Banner kind="error">{error}</Banner>}

          <div className="fc-form-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setView("choices")
                setError("")
              }}
              {...disabledWhen(running && "Saving…")}
            >
              Back
            </Button>
            <Button onClick={() => void handleCreateVariant()} pending={running} pendingLabel="Creating…">Create</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
