// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useState } from "react"
import { announce } from "@/lib/announce"
import Modal from "@/components/Modal"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import { Checkbox } from "@/components/ui/controls"
import { disabledWhen } from "@/lib/ui/disabled-props"

export const UNENCRYPTED_EXPORT_NOTICE =
  "This file is not encrypted and holds health information. Store it somewhere private."

export const PASSPHRASE_WARNING =
  "Without this passphrase the file cannot be opened, by you or by us. We do not keep it."

/**
 * Download dialog. Protection is off until the person asks for it. The passphrase is fetched
 * when they do, shown once, and dropped when the dialog closes.
 */
export default function ExportDownloadDialog({
  open,
  title,
  onClose,
  onDownload,
}: {
  open: boolean
  title: string
  onClose: () => void
  onDownload: (passphrase: string | null) => Promise<void>
}) {
  const [protect, setProtect] = useState(false)
  const [display, setDisplay] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(false)

  useEffect(() => {
    if (open) return
    setProtect(false)
    setDisplay(null)
    setSaved(false)
    setBusy(false)
    setPreparing(false)
  }, [open])

  async function toggleProtect(next: boolean) {
    setProtect(next)
    setSaved(false)
    setDisplay(null)
    if (!next) return
    setPreparing(true)
    try {
      const res = await fetch("/api/export/passphrase", { method: "POST" })
      const body = await res.json() as { passphrase?: string }
      if (!res.ok || typeof body.passphrase !== "string") {
        setProtect(false)
        announce("A passphrase could not be prepared.", "assertive")
        return
      }
      setDisplay(body.passphrase)
    } catch {
      setProtect(false)
      announce("A passphrase could not be prepared.", "assertive")
    } finally {
      setPreparing(false)
    }
  }

  async function copy() {
    if (!display) return
    try {
      await navigator.clipboard.writeText(display.replace(/ /g, ""))
      announce("Passphrase copied")
    } catch {
      announce("Could not copy the passphrase.", "assertive")
    }
  }

  async function download() {
    setBusy(true)
    try {
      await onDownload(protect ? display : null)
    } catch {
      announce("The export could not be downloaded.", "assertive")
    } finally {
      setBusy(false)
    }
  }

  const waiting = protect && (preparing || !display)
  const needsSaved = protect && !saved
  const reason = waiting
    ? "Preparing a passphrase."
    : needsSaved
      ? "Tick that you've saved the passphrase."
      : null

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <Checkbox
        label="Protect this file with a passphrase"
        checked={protect}
        onChange={event => { void toggleProtect(event.target.checked) }}
      />
      {!protect && <p className="fc-section-copy">{UNENCRYPTED_EXPORT_NOTICE}</p>}
      {protect && display && (
        <>
          <p className="fc-passphrase">{display}</p>
          <p className="fc-field__hint">The spaces are only to make it easier to read.</p>
          <Button variant="secondary" onClick={() => { void copy() }}>Copy</Button>
          <Banner kind="warning">{PASSPHRASE_WARNING}</Banner>
          <Checkbox
            label="I've saved the passphrase"
            checked={saved}
            onChange={event => setSaved(event.target.checked)}
          />
        </>
      )}
      <Button onClick={() => { void download() }} pending={busy} pendingLabel="Downloading…" {...disabledWhen(reason)}>
        Download
      </Button>
    </Modal>
  )
}
