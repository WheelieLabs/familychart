// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useState } from "react"
import { signIn, signOut } from "next-auth/react"
import { useSearchParams } from "next/navigation"
import { announce } from "@/lib/announce"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import FormField from "@/components/ui/FormField"
import Panel from "@/components/ui/Panel"
import { Input } from "@/components/ui/controls"
import { PasswordField } from "@/components/AuthShell"

interface Preview {
  warning: string
  audit_rows: number
  record_rows: number
  blocked_reason: string | null
}

/** Profile → Account. Removes the signed-in Account after a fresh sign-in. */
export default function RemoveMyAccount({
  isLocal,
  mfaEnrolled,
  linked,
}: {
  isLocal: boolean
  mfaEnrolled: boolean
  linked: boolean
}) {
  const searchParams = useSearchParams()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [otp, setOtp] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch("/api/me/remove-account")
      .then(async res => (res.ok ? res.json() as Promise<Preview> : null))
      .then(data => { if (!cancelled && data) setPreview(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (searchParams.get("confirmRemoveAccount") !== "1" || !preview || preview.blocked_reason) return
    void remove()
    // The fresh Entra sign-in has landed; finish the removal once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, preview])

  const blocked = linked
    ? "This account is still linked to a Person. Unlink it first, or erase the Person."
    : preview?.blocked_reason ?? null

  async function remove() {
    setPending(true)
    setError("")
    try {
      const res = await fetch("/api/me/remove-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isLocal ? { password, otp: otp || undefined } : {}),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Removal failed.")
        return
      }
      setDone(true)
      announce("Account removed.", "polite")
      await signOut({ redirect: false })
    } catch {
      setError("Removal failed.")
    } finally {
      setPending(false)
    }
  }

  if (done) {
    return (
      <Panel>
        <Banner kind="success">Your account was removed.</Banner>
      </Panel>
    )
  }

  const needsPassword = isLocal && password.length === 0
  const needsCode = isLocal && mfaEnrolled && otp.length === 0
  const confirmProps = blocked
    ? { disabled: true as const, disabledReason: blocked }
    : needsPassword
      ? { disabled: true as const, disabledReason: "Confirm your password to remove your account." }
      : needsCode
        ? { disabled: true as const, disabledReason: "Enter your authenticator code." }
        : { disabled: false as const }

  return (
    <Panel>
      <h2 className="fc-section-title">Remove my account</h2>
      <p className="fc-section-copy">
        Permanently remove your sign-in. This cannot be undone. To block sign-in and keep the account, an administrator can turn sign-in off instead.
      </p>
      {preview && (
        <p className="fc-section-copy">
          {preview.audit_rows} audit {preview.audit_rows === 1 ? "row" : "rows"} and {preview.record_rows} record {preview.record_rows === 1 ? "row" : "rows"} will show as Removed account.
        </p>
      )}
      {!open && (
        <Button
          variant="destructive"
          onClick={() => setOpen(true)}
          {...(blocked ? { disabled: true as const, disabledReason: blocked } : { disabled: false as const })}
        >
          Remove my account
        </Button>
      )}
      {open && isLocal && (
        <div className="fc-form">
          <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
          {mfaEnrolled && (
            <FormField label="Authenticator code">
              <Input value={otp} onChange={event => setOtp(event.target.value)} inputMode="numeric" autoComplete="one-time-code" />
            </FormField>
          )}
          {error && <Banner kind="error" announced>{error}</Banner>}
          <Button variant="destructive" pending={pending} pendingLabel="Removing…" {...confirmProps} onClick={() => { void remove() }}>
            Remove my account
          </Button>
        </div>
      )}
      {open && !isLocal && (
        <div className="fc-form">
          {error && <Banner kind="error" announced>{error}</Banner>}
          <Button
            variant="destructive"
            onClick={() => {
              void signIn(
                "microsoft-entra-id",
                { callbackUrl: "/profile?tab=account&confirmRemoveAccount=1" },
                { prompt: "login", max_age: "0" },
              )
            }}
            {...(blocked ? { disabled: true as const, disabledReason: blocked } : { disabled: false as const })}
          >
            Sign in again to remove your account
          </Button>
        </div>
      )}
    </Panel>
  )
}
