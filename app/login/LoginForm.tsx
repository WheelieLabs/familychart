// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { signIn } from "next-auth/react"
import { safeRelativeCallbackUrl } from "@/lib/safe-callback-url"
import { mainContentTargetProps } from "@/lib/a11y"

interface SsoProvider {
  id: string
  label: string
  icon: React.ReactNode
}

const ENTRA_ICON = (
  <svg width="21" height="21" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
    <rect x="1"  y="1"  width="9" height="9" fill="#f25022"/>
    <rect x="11" y="1"  width="9" height="9" fill="#7fba00"/>
    <rect x="1"  y="11" width="9" height="9" fill="#00a4ef"/>
    <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
  </svg>
)

interface LoginFormProps {
  enableEntra: boolean
  enableCredentials: boolean
}

export default function LoginForm({ enableEntra, enableCredentials }: LoginFormProps) {
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
  const showOtp = email.trim() !== "" && password.trim() !== ""

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await signIn("credentials", {
        email,
        password,
        otp: otp || undefined,
        callbackUrl: safeCb,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <main {...mainContentTargetProps} className="flex-1 bg-fc-blue flex flex-col items-center justify-center gap-8 px-8">
      <div className="w-24 h-24 rounded-2xl bg-white/20 flex items-center justify-center">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="white">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/>
        </svg>
      </div>

      <div className="text-center">
        <h2 className="text-white font-bold text-3xl mb-2">FamilyChart</h2>
        <p className="text-white text-sm">Sign in to continue</p>
      </div>

      {enableCredentials && hasError && (
        <div className="w-full bg-red-500/20 border border-red-400/40 rounded-xl px-4 py-3 text-white text-sm text-center">
          Invalid email, password, or authenticator code. Try again.
        </div>
      )}

      {enableCredentials && (
        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-3">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Email address"
            required
            autoComplete="email"
            className="bg-white/10 border border-white/20 text-white placeholder:text-white
                       rounded-xl px-4 py-3 w-full outline-none focus:border-white/50 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-fc-blue"
          />
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            required
            autoComplete="current-password"
            className="bg-white/10 border border-white/20 text-white placeholder:text-white
                       rounded-xl px-4 py-3 w-full outline-none focus:border-white/50 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-fc-blue"
          />
          {showOtp && (
            <>
              <p className="text-white text-sm text-center">
                If MFA is enabled on your account, enter your 6-digit authenticator code below.
              </p>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="Authenticator code (if required)"
                className="bg-white/10 border border-white/20 text-white placeholder:text-white
                           rounded-xl px-4 py-3 w-full outline-none focus:border-white/50 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-fc-blue tracking-widest text-center"
              />
            </>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white/20 hover:bg-white/30 active:bg-white/40 text-white
                       font-bold text-lg py-4 px-6 rounded-xl shadow-md transition-colors
                       disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in with Email"}
          </button>
        </form>
      )}

      {enableCredentials && ssoProviders.length > 0 && (
        <div className="w-full flex items-center gap-3">
          <div className="flex-1 border-t border-white/20" />
          <span className="text-white text-sm">or continue with</span>
          <div className="flex-1 border-t border-white/20" />
        </div>
      )}

      {!enableCredentials && ssoProviders.length > 0 && (
        <p className="text-white text-sm text-center">Sign in with:</p>
      )}

      {ssoProviders.length === 1 && (
        <button
          onClick={() => signIn(ssoProviders[0].id, { callbackUrl: safeCb })}
          className="w-full bg-white text-fc-blue font-bold text-lg py-4 px-6 rounded-xl
                     shadow-md flex items-center justify-center gap-3
                     hover:bg-gray-100 active:bg-gray-200 transition-colors"
        >
          {ssoProviders[0].icon}
          {ssoProviders[0].label}
        </button>
      )}

      {ssoProviders.length > 1 && (
        <div className="w-full flex flex-wrap items-center justify-center gap-3">
          {ssoProviders.map(p => (
            <button
              key={p.id}
              onClick={() => signIn(p.id, { callbackUrl: safeCb })}
              title={p.label}
              aria-label={p.label}
              className="w-14 h-14 shrink-0 bg-white rounded-xl shadow-md flex items-center justify-center
                         hover:bg-gray-100 active:bg-gray-200 transition-colors"
            >
              {p.icon}
            </button>
          ))}
        </div>
      )}

      <p className="text-white text-sm text-center">
        Access is restricted to authorised family accounts only.
      </p>
    </main>
  )
}
