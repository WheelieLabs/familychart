// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import AuthenticatorEnrolment from "@/components/AuthenticatorEnrolment"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { signIn } from "next-auth/react"
import AuthShell, { AuthCard, PasswordField } from "@/components/AuthShell"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import { Input } from "@/components/ui/controls"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import FormField from "@/components/ui/FormField"
import PageContainer from "@/components/ui/PageContainer"
import { useTokenFromFragment } from "@/lib/use-token-fragment"
import { useMfaEnrollment } from "@/lib/use-mfa-enrollment"

interface TokenPasswordFormProps {
  /** Endpoint that verifies the token and sets the password; must return `{ email }` on success. */
  apiUrl: string
  passwordMinLength: number
  heading: string
  subheading: string
  /** What the link is called in the dead-end screen shown when the URL has no token: "invite link" or "reset link". */
  linkNoun: "invite link" | "reset link"
  submitLabel: string
  submittingLabel: string
}

/**
 * Shared shape behind both `/reset-password` and `/accept-invite`: read a one-time token
 * from the URL fragment, POST a new password to `apiUrl`, then complete sign-in client-side.
 * Kept as one component (not two near-copies) so a fix to the token/session-handling logic —
 * fragment scrubbing, password validation, the sign-in-failure fallback — can't land in one
 * flow and silently miss the other.
 *
 * If the instance requires MFA and the account isn't enrolled yet, sign-in is followed by an
 * enrollment step (mirroring the setup wizard's "mfa" step) before the user is sent on — a
 * pending-MFA account can otherwise sign in with password alone (see
 * localAccountSignIn), so without this step the invitee lands on a page that then bounces
 * them to /profile with no explanation.
 */
export default function TokenPasswordForm({
  apiUrl,
  passwordMinLength,
  heading,
  subheading,
  linkNoun,
  submitLabel,
  submittingLabel,
}: TokenPasswordFormProps) {
  const router = useRouter()
  const token = useTokenFromFragment()
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signInFailed, setSignInFailed] = useState(false)
  const [needsMfa, setNeedsMfa] = useState(false)
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null)

  const mfa = useMfaEnrollment({
    onConfirmed: async ({ password: mfaPassword, code: mfaCode }) => {
      // Confirming rotates session_version and sets totp_secret, so the password-only
      // session from the initial sign-in is now stale — re-sign-in with the OTP included.
      if (!signedInEmail) {
        throw new Error("Authenticator confirmed, but re-sign-in failed. Sign in again to continue.")
      }
      const signRes = await signIn("credentials", {
        email: signedInEmail,
        password: mfaPassword,
        otp: mfaCode,
        redirect: false,
      })
      if (signRes?.error) {
        throw new Error("Authenticator confirmed, but re-sign-in failed. Sign in again to continue.")
      }
      router.push("/")
      router.refresh()
    },
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!token) return
    if (password.length < passwordMinLength) {
      setError(`Password must be at least ${passwordMinLength} characters.`)
      return
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }
    setBusy(true)
    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; email?: string }
      if (!res.ok || !data.email) {
        setError(data.error ?? "Could not set your password.")
        return
      }
      const signRes = await signIn("credentials", {
        email: data.email,
        password,
        redirect: false,
      })
      if (signRes?.error) {
        setSignInFailed(true)
        return
      }

      const meRes = await fetch("/api/me")
      const me = (await meRes.json().catch(() => ({}))) as { needsMfaEnrollment?: boolean }
      if (meRes.ok && me.needsMfaEnrollment) {
        setSignedInEmail(data.email)
        setNeedsMfa(true)
        return
      }

      router.push("/")
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  if (token === undefined) return null

  if (!token) {
    return (
      <>
        <PageContainer>
          <EmptyState
            icon={EMPTY_STATE_ICONS.invalidLink}
            heading={`This ${linkNoun} isn't valid`}
            action={<Button href="/login">Back to sign in</Button>}
          >
            It may have expired or already been used. Ask your administrator to send a new one.
          </EmptyState>
        </PageContainer>
      </>
    )
  }

  if (signInFailed) {
    return (
      <>
        <AuthShell heading="Password set">
          <AuthCard>
            <Banner kind="warning">
              Your password was set, but automatic sign-in failed. Please sign in with your new password.
            </Banner>
            <Button href="/login" fullWidth>Go to sign in</Button>
          </AuthCard>
        </AuthShell>
      </>
    )
  }

  if (needsMfa) {
    return (
      <>
        <AuthShell
          heading="Set up an authenticator"
          subheading="This instance requires a second sign-in step. Set it up now before continuing."
        >
          {!mfa.otpauth ? (
            <AuthCard onSubmit={mfa.start}>
              {mfa.error && <Banner kind="error">{mfa.error}</Banner>}
              <PasswordField
                label="Current password"
                value={mfa.password}
                onChange={mfa.setPassword}
                autoComplete="current-password"
              />
              <Button type="submit" fullWidth pending={mfa.busy} pendingLabel="Please wait…">Set up authenticator</Button>
            </AuthCard>
          ) : (
            <AuthCard onSubmit={mfa.confirm}>
              {mfa.error && <Banner kind="error">{mfa.error}</Banner>}
              <AuthenticatorEnrolment qr={mfa.qr} otpauth={mfa.otpauth} />
              <FormField label="Authenticator code" hint="6 digits.">
                <Input
                  type="text"
                  inputMode="numeric"
                  value={mfa.code}
                  onChange={e => mfa.setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                />
              </FormField>
              <Button type="submit" fullWidth pending={mfa.busy} pendingLabel="Confirming…">Confirm</Button>
            </AuthCard>
          )}
        </AuthShell>
      </>
    )
  }

  return (
    <>
      <AuthShell heading={heading} subheading={subheading}>
        <AuthCard onSubmit={handleSubmit}>
          {error && <Banner kind="error">{error}</Banner>}
          <PasswordField
            label="Password"
            value={password}
            onChange={setPassword}
            hint={`At least ${passwordMinLength} characters.`}
            autoComplete="new-password"
            minLength={passwordMinLength}
          />
          <PasswordField
            label="Confirm password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
          />
          <Button type="submit" fullWidth pending={busy} pendingLabel={submittingLabel}>{submitLabel}</Button>
        </AuthCard>
      </AuthShell>
    </>
  )
}
