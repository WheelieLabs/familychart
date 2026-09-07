// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { signIn } from "next-auth/react"
import { mainContentTargetProps } from "@/lib/a11y"
import { useTokenFromFragment } from "@/lib/use-token-fragment"
import { useMfaEnrollment } from "@/lib/use-mfa-enrollment"

interface TokenPasswordFormProps {
  /** Endpoint that verifies the token and sets the password; must return `{ email }` on success. */
  apiUrl: string
  passwordMinLength: number
  heading: string
  subheading: string
  /** Shown when the URL fragment has no token, or the server rejects it. */
  invalidTokenMessage: string
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
  invalidTokenMessage,
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
      <main {...mainContentTargetProps} className="flex-1 bg-fc-blue flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-white text-sm max-w-md">{invalidTokenMessage}</p>
      </main>
    )
  }

  if (signInFailed) {
    return (
      <main {...mainContentTargetProps} className="flex-1 bg-fc-blue flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-white text-sm max-w-md">
          Your password was set, but automatic sign-in failed. Please sign in with your new password.
        </p>
        <Link href="/login" className="text-white text-sm underline">
          Go to sign in
        </Link>
      </main>
    )
  }

  if (needsMfa) {
    return (
      <main {...mainContentTargetProps} className="flex-1 bg-fc-blue flex flex-col items-center justify-center gap-6 px-6 py-10">
        <div className="w-full max-w-md flex flex-col gap-3">
          <h2 className="text-white font-bold text-xl text-center mb-1">Set up an authenticator</h2>
          <p className="text-white text-sm text-center mb-2">
            This instance requires a second sign-in step. Set it up now before continuing.
          </p>

          {mfa.error && (
            <div className="w-full bg-red-500/20 border border-red-400/40 rounded-xl px-4 py-3 text-white text-sm text-center">
              {mfa.error}
            </div>
          )}

          {!mfa.otpauth ? (
            <form onSubmit={mfa.start} className="flex flex-col gap-3">
              <input
                type="password"
                value={mfa.password}
                onChange={e => mfa.setPassword(e.target.value)}
                placeholder="Confirm your password"
                required
                autoComplete="current-password"
                className="bg-white/10 border border-white/20 text-white placeholder:text-white
                           rounded-xl px-4 py-3 w-full outline-none focus:border-white/50 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-fc-blue"
              />
              <button
                type="submit"
                disabled={mfa.busy}
                className="w-full bg-white text-fc-blue font-bold text-lg py-4 px-6 rounded-xl shadow-md
                           hover:bg-gray-100 active:bg-gray-200 transition-colors disabled:opacity-50"
              >
                {mfa.busy ? "Please wait…" : "Set up authenticator"}
              </button>
            </form>
          ) : (
            <form onSubmit={mfa.confirm} className="flex flex-col gap-4">
              {mfa.qr && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mfa.qr}
                  alt="QR code"
                  className="w-48 h-48 mx-auto bg-white rounded-lg p-2 border border-white/20"
                />
              )}
              <p className="text-white text-xs text-center break-all">
                Or open this link on your phone:{" "}
                <a href={mfa.otpauth ?? "#"} className="text-white underline font-medium">
                  Add to authenticator
                </a>
              </p>
              <input
                type="text"
                inputMode="numeric"
                value={mfa.code}
                onChange={e => mfa.setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="6-digit code"
                required
                className="bg-white/95 border border-white/30 text-gray-900 rounded-xl px-4 py-3 w-full
                           outline-none focus:border-white/50 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-fc-blue text-center tracking-widest"
              />
              <button
                type="submit"
                disabled={mfa.busy}
                className="w-full bg-white text-fc-blue font-bold text-lg py-4 px-6 rounded-xl shadow-md
                           hover:bg-gray-100 active:bg-gray-200 transition-colors disabled:opacity-50"
              >
                {mfa.busy ? "Confirming…" : "Confirm"}
              </button>
            </form>
          )}
        </div>
      </main>
    )
  }

  return (
    <main {...mainContentTargetProps} className="flex-1 bg-fc-blue flex flex-col items-center justify-center gap-6 px-6 py-10">
      <div className="w-full max-w-md flex flex-col gap-3">
        <h2 className="text-white font-bold text-xl text-center mb-1">{heading}</h2>
        <p className="text-white text-sm text-center mb-2">{subheading}</p>

        {error && (
          <div className="w-full bg-red-500/20 border border-red-400/40 rounded-xl px-4 py-3 text-white text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={`Password (min. ${passwordMinLength} characters)`}
            required
            autoComplete="new-password"
            minLength={passwordMinLength}
            className="bg-white/10 border border-white/20 text-white placeholder:text-white
                       rounded-xl px-4 py-3 w-full outline-none focus:border-white/50 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-fc-blue"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Confirm password"
            required
            autoComplete="new-password"
            className="bg-white/10 border border-white/20 text-white placeholder:text-white
                       rounded-xl px-4 py-3 w-full outline-none focus:border-white/50 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-fc-blue"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-white text-fc-blue font-bold text-lg py-4 px-6 rounded-xl shadow-md
                       hover:bg-gray-100 active:bg-gray-200 transition-colors disabled:opacity-50"
          >
            {busy ? submittingLabel : submitLabel}
          </button>
        </form>
      </div>
    </main>
  )
}
