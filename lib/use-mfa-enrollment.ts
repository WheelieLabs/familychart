// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useState } from "react"

export interface MfaEnrollmentProof {
  password: string
  code: string
}

export interface UseMfaEnrollmentOptions {
  /**
   * Called once POST /api/me/mfa/confirm succeeds, after the flow has reset to idle. Throw
   * (an `Error`, message shown as the flow's error) to report a post-confirm failure — e.g.
   * setup's re-sign-in with the new OTP — without the caller reaching back into this hook's
   * own state from inside its definition.
   */
  onConfirmed?: (proof: MfaEnrollmentProof) => void | Promise<void>
}

export interface UseMfaEnrollmentResult {
  password: string
  setPassword: (value: string) => void
  code: string
  setCode: (value: string) => void
  qr: string | null
  otpauth: string | null
  busy: boolean
  error: string
  start: (e: React.FormEvent) => Promise<void>
  confirm: (e: React.FormEvent) => Promise<void>
  cancel: () => void
}

/**
 * TOTP enrollment chrome shared by the setup wizard's MFA step and the Profile Account tab
 * (see CONTEXT.md "Local Account re-auth"): password → POST /api/me/mfa/setup
 * → QR/otpauth → code → POST /api/me/mfa/confirm. Owns only the fetch/validation state
 * machine — markup and post-confirm behaviour (setup re-signs-in with the new OTP; Profile
 * just reloads /api/me) stay with each caller via `onConfirmed`.
 */
export function useMfaEnrollment({ onConfirmed }: UseMfaEnrollmentOptions = {}): UseMfaEnrollmentResult {
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [qr, setQr] = useState<string | null>(null)
  const [otpauth, setOtpauth] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function start(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setBusy(true)
    try {
      const res = await fetch("/api/me/mfa/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof j.error === "string" ? j.error : "Setup failed.")
        return
      }
      setQr((j as { qrDataUrl?: string }).qrDataUrl ?? null)
      setOtpauth((j as { otpauthUrl?: string }).otpauthUrl ?? null)
      setCode("")
    } finally {
      setBusy(false)
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setBusy(true)
    try {
      const res = await fetch("/api/me/mfa/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, password }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof j.error === "string" ? j.error : "Confirmation failed.")
        return
      }
      const proof: MfaEnrollmentProof = { password, code }
      setQr(null)
      setOtpauth(null)
      setCode("")
      setPassword("")
      try {
        await onConfirmed?.(proof)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
      }
    } finally {
      setBusy(false)
    }
  }

  function cancel() {
    setQr(null)
    setOtpauth(null)
    setCode("")
    setPassword("")
    setError("")
  }

  return { password, setPassword, code, setCode, qr, otpauth, busy, error, start, confirm, cancel }
}
