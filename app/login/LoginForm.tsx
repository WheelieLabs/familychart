// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { signIn } from "next-auth/react"
import AuthShell, { AuthCard, PasswordField } from "@/components/AuthShell"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import { Input } from "@/components/ui/controls"
import FormField from "@/components/ui/FormField"
import IconButton from "@/components/ui/IconButton"
import { safeRelativeCallbackUrl } from "@/lib/safe-callback-url"

interface SsoProvider {
  id: string
  label: string
  icon: React.ReactNode
}

const ENTRA_ICON = (
  <svg width="21" height="21" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="1"  y="1"  width="9" height="9" fill="#f25022"/>
    <rect x="11" y="1"  width="9" height="9" fill="#7fba00"/>
    <rect x="1"  y="11" width="9" height="9" fill="#00a4ef"/>
    <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
  </svg>
)

const EMAIL_ID = "login-email"

interface LoginFormProps {
  enableEntra: boolean
  enableCredentials: boolean
  /** The instance enforces MFA, so the authenticator code is not optional. */
  mfaRequired?: boolean
}

export default function LoginForm({ enableEntra, enableCredentials, mfaRequired = false }: LoginFormProps) {
  const searchParams = useSearchParams()
  const hasError = searchParams.get("error") === "CredentialsSignin"
  const safeCb = safeRelativeCallbackUrl(searchParams.get('callbackUrl'))

  // Structured as a list so the 2+ icon-row layout works unmodified once more
  // SSO providers ship; Entra-only is the live v1.0.0 case.
  const ssoProviders: SsoProvider[] = enableEntra
    ? [{ id: "microsoft-entra-id", label: "Sign in with Microsoft", icon: ENTRA_ICON }]
    : []

  const [email, setEmail]       = useState("")
  const [password, setPassword] = useState("")
  const [otp, setOtp]           = useState("")
  const [loading, setLoading]   = useState(false)

  // After a failed sign-in the page reloads with the error: put focus back on the email field.
  useEffect(() => {
    if (hasError) document.getElementById(EMAIL_ID)?.focus()
  }, [hasError])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await signIn("credentials", {
        email,
        password,
        otp,
        callbackUrl: safeCb,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell heading="Sign in" subheading="Sign in to continue">
      {enableCredentials && (
        <AuthCard onSubmit={handleSubmit}>
          {/* Deliberately generic: it never says which part was wrong. */}
          {hasError && <Banner kind="error">Email or password is incorrect.</Banner>}
          <FormField id={EMAIL_ID} label="Email address">
            <Input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </FormField>
          <PasswordField
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
          <FormField label="Authenticator code"
            optional={!mfaRequired}
            hint={mfaRequired ? undefined : "Only if your account uses an authenticator app."}>
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </FormField>
          <Button type="submit" fullWidth pending={loading} pendingLabel="Signing in…">Sign in</Button>

          {ssoProviders.length > 0 && <p className="fc-auth__divider">or continue with</p>}
          {ssoProviders.length === 1 && (
            <Button variant="secondary" fullWidth onClick={() => signIn(ssoProviders[0].id, { callbackUrl: safeCb })}>
              {ssoProviders[0].icon}
              {ssoProviders[0].label}
            </Button>
          )}
          {ssoProviders.length > 1 && (
            <div className="fc-auth__sso">
              {ssoProviders.map(p => (
                <IconButton key={p.id} label={p.label} onClick={() => signIn(p.id, { callbackUrl: safeCb })}>
                  {p.icon}
                </IconButton>
              ))}
            </div>
          )}
        </AuthCard>
      )}

      {!enableCredentials && ssoProviders.length > 0 && (
        <AuthCard>
          <p className="fc-section-copy">Sign in with:</p>
          {ssoProviders.length === 1 ? (
            <Button fullWidth onClick={() => signIn(ssoProviders[0].id, { callbackUrl: safeCb })}>
              {ssoProviders[0].icon}
              {ssoProviders[0].label}
            </Button>
          ) : (
            <div className="fc-auth__sso">
              {ssoProviders.map(p => (
                <IconButton key={p.id} label={p.label} onClick={() => signIn(p.id, { callbackUrl: safeCb })}>
                  {p.icon}
                </IconButton>
              ))}
            </div>
          )}
        </AuthCard>
      )}

      <p className="fc-auth__fine">Access is restricted to authorised family accounts only.</p>
    </AuthShell>
  )
}
