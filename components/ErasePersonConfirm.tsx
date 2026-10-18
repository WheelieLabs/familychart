// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { signOut } from "next-auth/react"
import { announce } from "@/lib/announce"
import { formatDate } from "@/lib/date-format"
import { downloadPersonExport, personExportInFlight, subscribePersonExports } from "@/lib/export/download-person-export"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import FormField from "@/components/ui/FormField"
import { Input, Toggle } from "@/components/ui/controls"
import Panel from "@/components/ui/Panel"

interface AccountOption {
  email: string
  role: string
  remove_default: boolean
  remove_blocked_reason: string | null
  is_own: boolean
  is_local: boolean
  mfa_enrolled: boolean
}

interface Preview {
  name: string
  is_active: number
  counts_label: string
  backup_notice: string
  account: AccountOption | null
}

interface EraseResult {
  erased_at: string
  erase_again: string
  account_outcome: "kept" | "deactivated" | "removed" | null
  account_note: string | null
  file_failures: { path: string; reason: string }[]
}

const ACCOUNT_STAYS = "This account stays unless an administrator removes it."
const ACCOUNT_SIGNED_OUT = "This account has been deactivated and the person is signed out."
const ACCOUNT_REMOVED = "This account has been permanently removed."

export default function ErasePersonConfirm({
  personId,
  mode,
  isLocal = false,
  mfaEnrolled = false,
}: {
  personId: number
  mode: "admin" | "self"
  isLocal?: boolean
  mfaEnrolled?: boolean
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loadError, setLoadError] = useState("")
  const [typed, setTyped] = useState("")
  const [nameError, setNameError] = useState("")
  const [password, setPassword] = useState("")
  const [otp, setOtp] = useState("")
  const [formError, setFormError] = useState("")
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<EraseResult | null>(null)
  const [exporting, setExporting] = useState(() => personExportInFlight(personId))
  const [removeAccount, setRemoveAccount] = useState(false)
  const removeReady = useRef(false)

  useEffect(() => subscribePersonExports(() => setExporting(personExportInFlight(personId))), [personId])

  useEffect(() => {
    if (mode === "self" && (result?.account_outcome === "deactivated" || result?.account_outcome === "removed")) {
      void signOut({ redirect: false })
    }
  }, [mode, result])

  useEffect(() => {
    if (!result) return
    const when = formatDate(result.erased_at)
    const head = when ? `Erased on ${when}.` : "Erased."
    announce(`${head} ${result.erase_again}`, "polite")
  }, [result])

  useEffect(() => {
    let cancelled = false
    removeReady.current = false
    fetch(`/api/people/${personId}/erase`)
      .then(async r => {
        if (!r.ok) throw new Error()
        return r.json() as Promise<Preview>
      })
      .then(data => {
        if (cancelled) return
        setPreview(data)
        if (!removeReady.current && data.account) {
          removeReady.current = true
          setRemoveAccount(data.account.remove_default && !data.account.remove_blocked_reason)
        }
        announce(`${data.counts_label}. ${data.backup_notice}`)
      })
      .catch(() => { if (!cancelled) setLoadError("This person could not be loaded.") })
    return () => { cancelled = true }
  }, [personId])

  if (loadError) return <Banner kind="error">{loadError}</Banner>
  if (!preview) return <p className="fc-export-note">Loading…</p>
  if (mode === "admin" && preview.is_active) {
    return <Banner kind="warning">Deactivate this person before erasing them.</Banner>
  }
  if (result) {
    const when = formatDate(result.erased_at)
    return (
      <>
        <Banner kind="success">
          {when ? `Erased on ${when}.` : "Erased."}
        </Banner>
        <p className="fc-section-copy fc-surface-copy">{result.erase_again}</p>
        <p className="fc-section-copy fc-surface-copy">{preview.backup_notice}</p>
        {result.account_outcome === "kept" && <p className="fc-section-copy fc-surface-copy">{ACCOUNT_STAYS}</p>}
        {result.account_outcome === "deactivated" && <p className="fc-section-copy fc-surface-copy">{ACCOUNT_SIGNED_OUT}</p>}
        {result.account_outcome === "removed" && <p className="fc-section-copy fc-surface-copy">{ACCOUNT_REMOVED}</p>}
        {result.account_note && <p className="fc-section-copy fc-surface-copy">{result.account_note}</p>}
        {result.file_failures.length > 0 && (
          <Banner kind="error" announced>
            {result.file_failures.map(failure => failure.reason).join(" ")}
          </Banner>
        )}
      </>
    )
  }

  const nameMatches = typed === preview.name
  // An Admin removing their own Account proves it afresh, as a holder erasing their own records does.
  const removingOwn = mode === "admin" && Boolean(preview.account?.is_own && removeAccount && !preview.account.remove_blocked_reason)
  const reauthLocal = mode === "self" ? isLocal : removingOwn && Boolean(preview.account?.is_local)
  const reauthMfa = mode === "self" ? mfaEnrolled : Boolean(preview.account?.mfa_enrolled)
  const needsPassword = reauthLocal && password.length === 0
  const needsCode = reauthLocal && reauthMfa && otp.length === 0
  const eraseProps = exporting
    ? { disabled: true as const, disabledReason: "An export of this person is still downloading." }
    : !nameMatches
      ? { disabled: true as const, disabledReason: "Type their name exactly." }
      : needsPassword
        ? { disabled: true as const, disabledReason: "Confirm your password to erase your records." }
        : needsCode
          ? { disabled: true as const, disabledReason: "Enter your authenticator code." }
          : { disabled: false as const }

  function onNameBlur() {
    if (typed.length > 0 && typed !== preview!.name) {
      setNameError(`Type ${preview!.name} exactly.`)
      announce("1 problem to fix. First: Type their name.", "assertive")
    }
  }

  async function download() {
    setFormError("")
    try {
      await downloadPersonExport(personId)
    } catch {
      setFormError("The export could not be downloaded.")
    }
  }

  async function erase() {
    setFormError("")
    setPending(true)
    try {
      const res = await fetch(`/api/people/${personId}/erase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(reauthLocal ? { password, otp: otp || undefined } : {}),
          ...(preview?.account && removeAccount && !preview.account.remove_blocked_reason
            ? { remove_account: true }
            : {}),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFormError(typeof body.error === "string" ? body.error : "Erase failed.")
        return
      }
      setResult(body as EraseResult)
    } catch {
      setFormError("Erase failed.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Panel as="form" onSubmit={(event: FormEvent) => { event.preventDefault(); if (nameMatches) void erase() }}>
      {mode === "self" && (
        <p className="fc-section-copy">This takes you off the family list and erases your records in one step.</p>
      )}
      <p className="fc-section-copy">{preview.counts_label}</p>
      <Banner kind="warning">{preview.backup_notice}</Banner>
      <FormField label="Type their name" error={nameError || undefined}>
        <Input
          value={typed}
          onChange={event => {
            const value = event.target.value
            setTyped(value)
            if (value === preview.name) setNameError("")
          }}
          onBlur={onNameBlur}
          autoComplete="off"
        />
      </FormField>
      {reauthLocal && (
        <FormField label="Password for this erase">
          <Input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" />
        </FormField>
      )}
      {reauthLocal && reauthMfa && (
        <FormField label="Authenticator code">
          <Input value={otp} onChange={event => setOtp(event.target.value)} inputMode="numeric" autoComplete="one-time-code" />
        </FormField>
      )}
      {preview.account && (
        <Toggle
          label="Also permanently remove their Account"
          hint="Removing an account cannot be undone. Turning sign-in off can be turned back on."
          checked={removeAccount}
          onChange={setRemoveAccount}
          {...(preview.account.remove_blocked_reason
            ? { disabled: true as const, disabledReason: preview.account.remove_blocked_reason }
            : { disabled: false as const })}
        />
      )}
      {formError && <Banner kind="error" announced>{formError}</Banner>}
      <div className="fc-form-actions">
        <Button onClick={() => { void download() }}>Download export first</Button>
        <Button variant="destructive" pending={pending} pendingLabel="Erasing…" {...eraseProps} onClick={() => { void erase() }}>
          Erase
        </Button>
      </div>
    </Panel>
  )
}
