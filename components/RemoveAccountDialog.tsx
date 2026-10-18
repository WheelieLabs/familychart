// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useState } from "react"
import { announce } from "@/lib/announce"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import FormField from "@/components/ui/FormField"
import Modal from "@/components/Modal"
import { Input } from "@/components/ui/controls"

interface Preview {
  email: string
  deleted: string[]
  warning: string
  audit_rows: number
  record_rows: number
  blocked_reason: string | null
}

export default function RemoveAccountDialog({
  accountId,
  onClose,
  onRemoved,
}: {
  accountId: number
  onClose: () => void
  onRemoved: () => void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [typed, setTyped] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/accounts/${accountId}/remove`)
      .then(async res => {
        if (!res.ok) throw new Error()
        return res.json() as Promise<Preview>
      })
      .then(data => {
        if (cancelled) return
        setPreview(data)
        announce(`${data.warning} ${data.audit_rows} audit rows and ${data.record_rows} record rows will be rewritten.`)
      })
      .catch(() => { if (!cancelled) setError("This account could not be loaded.") })
    return () => { cancelled = true }
  }, [accountId])

  const emailMatches = preview != null && typed.trim().toLowerCase() === preview.email.trim().toLowerCase()
  const confirmProps = preview?.blocked_reason
    ? { disabled: true as const, disabledReason: preview.blocked_reason }
    : !emailMatches
      ? { disabled: true as const, disabledReason: "Type this account's email to confirm." }
      : { disabled: false as const }

  async function remove() {
    if (!preview || !emailMatches) return
    setPending(true)
    setError("")
    try {
      const res = await fetch(`/api/accounts/${accountId}/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: typed.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Removal failed.")
        return
      }
      announce("Account removed.", "polite")
      onRemoved()
    } catch {
      setError("Removal failed.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Remove account">
      <div className="fc-form">
        {error && <Banner kind="error" announced>{error}</Banner>}
        {!preview && !error && <p className="fc-section-copy">Loading…</p>}
        {preview && (
          <>
            <Banner kind="warning">{preview.warning}</Banner>
            <p className="fc-section-copy">
              This deletes {preview.deleted.join("; ").replace(/; ([^;]*)$/, "; and $1")}.
            </p>
            <p className="fc-section-copy">
              {preview.audit_rows} audit {preview.audit_rows === 1 ? "row" : "rows"} and {preview.record_rows} record {preview.record_rows === 1 ? "row" : "rows"} will show as Removed account. The old email is not kept.
            </p>
            <FormField label="Type their email">
              <Input value={typed} onChange={event => setTyped(event.target.value)} autoComplete="off" />
            </FormField>
            <div className="fc-form-actions">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button variant="destructive" pending={pending} pendingLabel="Removing…" {...confirmProps} onClick={() => { void remove() }}>
                Remove account
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
