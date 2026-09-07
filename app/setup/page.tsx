// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { signIn } from "next-auth/react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import { IANA_TIMEZONES } from "@/lib/settings/registry"
import type { SetupStepKey, SetupWizardContext } from "@/lib/setup-gate"
import { mainContentTargetProps } from "@/lib/a11y"
import { useMfaEnrollment } from "@/lib/use-mfa-enrollment"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const STEP_LABELS: Record<SetupStepKey, string> = {
  account: "Account",
  mfa: "Authenticator",
  person: "Person",
  timezone: "Timezone",
  smtp: "Email",
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function SetupContent() {
  const router = useRouter()
  const [wizard, setWizard] = useState<SetupWizardContext | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [stepKey, setStepKey] = useState<SetupStepKey>("account")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  const [personName, setPersonName] = useState("")
  const [dateOfBirth, setDateOfBirth] = useState("")
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [timezone, setTimezone] = useState("")

  const [smtpHost, setSmtpHost] = useState("")
  const [smtpPort, setSmtpPort] = useState("587")
  const [smtpUser, setSmtpUser] = useState("")
  const [smtpPassword, setSmtpPassword] = useState("")
  const [smtpTls, setSmtpTls] = useState("true")

  const stepIndex = useMemo(() => {
    if (!wizard) return 0
    const idx = wizard.displaySteps.indexOf(stepKey)
    return idx >= 0 ? idx : 0
  }, [wizard, stepKey])

  const loadWizard = useCallback(async () => {
    const res = await fetch("/api/setup/status")
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? `Setup status failed (${res.status})`)
    }
    return res.json() as Promise<SetupWizardContext>
  }, [])

  const refreshWizard = useCallback(() => {
    setLoadError(null)
    setWizard(null)
    loadWizard()
      .then(data => {
        if (data.complete) {
          router.replace("/")
          return
        }
        setWizard(data)
        setStepKey(data.initialStep)
      })
      .catch(err => {
        setLoadError(err instanceof Error ? err.message : "Could not load setup")
      })
  }, [loadWizard, router])

  useEffect(() => {
    refreshWizard()
  }, [refreshWizard])

  useEffect(() => {
    if (stepKey === "timezone" && timezone === "") {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone)
    }
  }, [stepKey, timezone])

  function goNext() {
    if (!wizard) return
    const idx = wizard.steps.indexOf(stepKey)
    if (idx >= 0 && idx < wizard.steps.length - 1) {
      setStepKey(wizard.steps[idx + 1])
    }
  }

  const mfa = useMfaEnrollment({
    onConfirmed: async ({ password: mfaPassword, code: mfaCode }) => {
      // Confirming bumps session_version (jwt callback revokes the current
      // session) and totp_secret is now set, so credentials authorize()
      // requires the OTP — password-only sign-in would fail and leave the
      // wizard unauthenticated (timezone then 401s).
      const wizardEmail = wizard?.currentUserEmail
      if (!wizardEmail) {
        setStepKey("account")
        throw new Error("Authenticator confirmed, but re-sign-in failed. Sign in again to continue.")
      }
      const signRes = await signIn("credentials", {
        email: wizardEmail,
        password: mfaPassword,
        otp: mfaCode,
        redirect: false,
      })
      if (signRes?.error) {
        setStepKey("account")
        throw new Error("Authenticator confirmed, but re-sign-in failed. Sign in again to continue.")
      }
      const refreshed = await loadWizard()
      if (refreshed) {
        setWizard(refreshed)
        setStepKey(refreshed.initialStep)
      } else {
        goNext()
      }
    },
  })

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPreviewUrl(URL.createObjectURL(file))
    setUploading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/upload", { method: "POST", body: fd })
      if (!res.ok) throw new Error()
      const { url } = (await res.json()) as { url: string }
      setPhotoUrl(url)
    } catch {
      setPreviewUrl(null)
      setError("Photo upload failed. Please try again.")
    } finally {
      setUploading(false)
    }
  }

  async function handleStepAccount(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const em = email.trim()
    if (!EMAIL_RE.test(em)) {
      setError("Enter a valid email address.")
      return
    }
    const passwordMinLength = wizard?.passwordMinLength ?? 10
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
      const res = await fetch("/api/setup/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: em, password, confirmPassword }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Could not create account.")
        return
      }
      const signRes = await signIn("credentials", {
        email: em,
        password,
        redirect: false,
      })
      if (signRes?.error) {
        setError("Account created but sign-in failed. Try signing in from the login page.")
        return
      }
      const refreshed = await loadWizard()
      if (refreshed) {
        setWizard(refreshed)
        setStepKey(refreshed.initialStep)
      } else {
        goNext()
      }
    } finally {
      setBusy(false)
    }
  }

  function skipPerson() {
    setError(null)
    if (!wizard?.authenticated) {
      setStepKey("account")
      return
    }
    setStepKey("timezone")
  }

  async function handleStepPerson(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const name = personName.trim()
    if (!name) {
      setError("Name is required.")
      return
    }
    if (!dateOfBirth) {
      setError("Date of birth is required.")
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          date_of_birth: dateOfBirth,
          photo_url: photoUrl,
          color: "#256AA5",
          sort_order: 0,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (res.status === 401) {
          setError("Your session expired. Sign in again to finish setup.")
          setStepKey("account")
          return
        }
        setError((data as { error?: string }).error ?? "Could not add person.")
        return
      }
      setStepKey("timezone")
    } finally {
      setBusy(false)
    }
  }

  async function finishSetup(body: Record<string, unknown> = {}) {
    const res = await fetch("/api/setup/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        setError("Your session expired. Sign in again to finish setup.")
        setStepKey("account")
        return false
      }
      setError((data as { error?: string }).error ?? "Could not finish setup.")
      return false
    }
    router.push("/?welcome=1")
    router.refresh()
    return true
  }

  async function handleStepTimezone(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const tz = timezone.trim()
    if (!tz) {
      setError("Choose a timezone for your household.")
      return
    }
    setBusy(true)
    try {
      if (wizard?.mode === "managed") {
        await finishSetup({ timezone: tz })
        return
      }
      const res = await fetch("/api/setup/timezone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: tz }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (res.status === 401) {
          setError("Your session expired. Sign in again to finish setup.")
          setStepKey("account")
          return
        }
        setError((data as { error?: string }).error ?? "Could not save timezone.")
        return
      }
      if (wizard?.steps.includes("smtp")) {
        setStepKey("smtp")
      } else {
        await finishSetup({})
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleStepSmtp(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const hasSmtp = smtpHost.trim() !== ""
      await finishSetup(
        hasSmtp
          ? {
              smtp: {
                host: smtpHost.trim(),
                port: smtpPort.trim(),
                user: smtpUser.trim(),
                password: smtpPassword,
                tls: smtpTls,
              },
            }
          : {},
      )
    } finally {
      setBusy(false)
    }
  }

  async function skipSmtp() {
    setBusy(true)
    setError(null)
    try {
      await finishSetup({})
    } finally {
      setBusy(false)
    }
  }

  if (loadError) {
    return (
      <main {...mainContentTargetProps} className="flex-1 bg-fc-blue flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-white text-sm max-w-md">{loadError}</p>
        <p className="text-white text-sm max-w-md">
          If this persists, check that the dev server is running and{" "}
          <code className="text-white">/api/health</code> reports the database as connected.
        </p>
        <button
          type="button"
          onClick={refreshWizard}
          className="bg-white text-fc-blue font-semibold text-sm py-2 px-4 rounded-lg shadow-md
                     hover:bg-gray-100 active:bg-gray-200 transition-colors"
        >
          Try again
        </button>
      </main>
    )
  }

  if (!wizard) {
    return (
      <main {...mainContentTargetProps} className="flex-1 bg-fc-blue flex items-center justify-center text-white text-sm">
        Loading setup…
      </main>
    )
  }

  const accountSignInOnly = stepKey === "account" && !wizard.bootstrapAllowed

  return (
    <main {...mainContentTargetProps} className="flex-1 bg-fc-blue flex flex-col items-center justify-center gap-6 px-6 py-10">
      <div className="w-full max-w-md flex flex-col gap-4">
        <div className="text-center text-white text-sm leading-relaxed space-y-2 px-1">
          <p>
            FamilyChart helps you track medications and health observations for everyone in your
            household—dose history, timing rules, and recurring checks in one place.
          </p>
          {wizard.mode === "managed" ? (
            <p>Add your first person and confirm your household timezone to finish provisioning.</p>
          ) : (
            <p>
              Your dashboard highlights what needs attention so you can stay on top of care without
              juggling spreadsheets or memory alone.
            </p>
          )}
        </div>

        <div className="flex justify-center gap-2 mb-2">
          {wizard.displaySteps.map((s, i) => (
            <div key={s} className="flex flex-col items-center gap-1 flex-1 max-w-[5.5rem]">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold
                  ${stepIndex >= i ? "bg-white text-fc-blue" : "bg-white/25 text-white"}`}
              >
                {i + 1}
              </div>
              <span className="text-[0.625rem] text-white text-center leading-snug">
                {STEP_LABELS[s]}
              </span>
            </div>
          ))}
        </div>

        {error && (
          <div className="w-full bg-red-500/20 border border-red-400/40 rounded-xl px-4 py-3 text-white text-sm text-center">
            {error}
          </div>
        )}

        {stepKey === "account" && (
          <div className="w-full flex flex-col gap-3">
            {accountSignInOnly ? (
              <>
                <h2 className="text-white font-bold text-xl text-center mb-1">Sign in to continue</h2>
                <p className="text-white text-sm text-center mb-2">
                  An administrator must sign in before configuring this instance.
                </p>
                {wizard.entraSignInAvailable && (
                  <button
                    type="button"
                    onClick={() => signIn("microsoft-entra-id", { callbackUrl: "/setup" })}
                    className="w-full bg-white text-fc-blue font-bold text-lg py-4 px-6 rounded-xl shadow-md
                               hover:bg-gray-100 transition-colors"
                  >
                    Sign in with Microsoft
                  </button>
                )}
                <Link
                  href="/login?callbackUrl=%2Fsetup"
                  className="text-white text-sm underline text-center py-2"
                >
                  Sign in with local credentials
                </Link>
              </>
            ) : (
              <form onSubmit={handleStepAccount} className="flex flex-col gap-3">
                <h2 className="text-white font-bold text-xl text-center mb-1">Create admin account</h2>
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
                  placeholder={`Password (min. ${wizard?.passwordMinLength ?? 10} characters)`}
                  required
                  autoComplete="new-password"
                  minLength={wizard?.passwordMinLength ?? 10}
                  className="bg-white/10 border border-white/20 text-white placeholder:text-white
                             rounded-xl px-4 py-3 w-full outline-none focus:border-white/50 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-fc-blue"
                />
                {password.length > 0 && password.length < (wizard?.passwordMinLength ?? 10) && (
                  <p className="text-white text-xs -mt-2">
                    {(wizard?.passwordMinLength ?? 10) - password.length} more character
                    {(wizard?.passwordMinLength ?? 10) - password.length === 1 ? "" : "s"} needed
                  </p>
                )}
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
                  {busy ? "Please wait…" : "Continue"}
                </button>
                {wizard.entraSignInAvailable && (
                  <button
                    type="button"
                    onClick={() => signIn("microsoft-entra-id", { callbackUrl: "/setup" })}
                    className="text-white text-sm underline text-center py-2"
                  >
                    Already have a Microsoft admin account? Sign in
                  </button>
                )}
              </form>
            )}
          </div>
        )}

        {stepKey === "mfa" && (
          <div className="w-full flex flex-col gap-3">
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
        )}

        {stepKey === "person" && (
          <div className="w-full flex flex-col gap-3">
            <h2 className="text-white font-bold text-xl text-center mb-1">Add your first person</h2>
            <p className="text-white text-sm text-center mb-2">
              You can add more family members later from Management.
            </p>

            <div className="flex items-center gap-4 justify-center">
              <div
                className="w-20 h-20 rounded-full border-2 border-white/40 overflow-hidden shrink-0
                            flex items-center justify-center bg-white/10"
              >
                {previewUrl || photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl ?? photoUrl ?? ""} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-white font-bold text-2xl">{initials(personName || "?")}</span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="bg-white/20 hover:bg-white/30 text-white text-sm font-bold px-4 py-2 rounded-lg
                             disabled:opacity-50 transition-colors"
                >
                  {uploading ? "Uploading…" : previewUrl || photoUrl ? "Change photo" : "Add photo (optional)"}
                </button>
                {(previewUrl || photoUrl) && (
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewUrl(null)
                      setPhotoUrl(null)
                    }}
                    className="text-white text-sm underline text-left"
                  >
                    Remove photo
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handlePhotoSelect}
              />
            </div>

            <form onSubmit={handleStepPerson} className="flex flex-col gap-3">
              <input
                type="text"
                value={personName}
                onChange={e => setPersonName(e.target.value)}
                placeholder="Full name"
                className="bg-white/10 border border-white/20 text-white placeholder:text-white
                           rounded-xl px-4 py-3 w-full outline-none focus:border-white/50 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-fc-blue"
              />
              <div>
                <label className="text-white text-sm block mb-1">Date of birth</label>
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={e => setDateOfBirth(e.target.value)}
                  className="bg-white/10 border border-white/20 text-white rounded-xl px-4 py-3 w-full
                             outline-none focus:border-white/50 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-fc-blue [color-scheme:dark]"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full bg-white text-fc-blue font-bold text-lg py-4 px-6 rounded-xl shadow-md
                           hover:bg-gray-100 active:bg-gray-200 transition-colors disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save and continue"}
              </button>
            </form>

            <button
              type="button"
              onClick={skipPerson}
              className="text-white text-sm underline text-center py-2"
            >
              Skip for now
            </button>
          </div>
        )}

        {stepKey === "timezone" && (
          <form onSubmit={handleStepTimezone} className="w-full flex flex-col gap-4">
            <h2 className="text-white font-bold text-xl text-center">Household timezone</h2>
            <p className="text-white text-sm text-center">
              Confirm your timezone for medication and observation reminders.
            </p>
            <div className="flex flex-col gap-1 text-left">
              <label htmlFor="setup-timezone" className="text-white text-sm font-semibold">
                Timezone
              </label>
              <input
                id="setup-timezone"
                type="text"
                list="setup-iana-tz-list"
                value={timezone}
                onChange={e => setTimezone(e.target.value)}
                disabled={busy}
                required
                className="bg-white/95 border border-white/30 text-gray-900 rounded-xl px-4 py-3 w-full
                           outline-none focus:border-white/50 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-fc-blue disabled:opacity-50"
                placeholder="e.g. Australia/Sydney"
              />
              <datalist id="setup-iana-tz-list">
                {IANA_TIMEZONES.map(tz => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
            </div>
            <button
              type="submit"
              disabled={busy || timezone.trim() === ""}
              className="w-full bg-white text-fc-blue font-bold text-lg py-4 px-6 rounded-xl shadow-md
                         hover:bg-gray-100 active:bg-gray-200 transition-colors disabled:opacity-50"
            >
              {busy ? "Saving…" : wizard.steps.includes("smtp") ? "Continue" : "Go to FamilyChart"}
            </button>
          </form>
        )}

        {stepKey === "smtp" && (
          <form onSubmit={handleStepSmtp} className="w-full flex flex-col gap-3">
            <h2 className="text-white font-bold text-xl text-center">Outbound email (optional)</h2>
            <p className="text-white text-sm text-center">
              Configure SMTP now or skip and set it later under System Settings.
            </p>
            <input
              type="text"
              value={smtpHost}
              onChange={e => setSmtpHost(e.target.value)}
              placeholder="SMTP host"
              className="bg-white/10 border border-white/20 text-white placeholder:text-white
                         rounded-xl px-4 py-3 w-full outline-none focus:border-white/50 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-fc-blue"
            />
            <input
              type="number"
              value={smtpPort}
              onChange={e => setSmtpPort(e.target.value)}
              placeholder="Port"
              className="bg-white/10 border border-white/20 text-white placeholder:text-white
                         rounded-xl px-4 py-3 w-full outline-none focus:border-white/50 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-fc-blue"
            />
            <input
              type="text"
              value={smtpUser}
              onChange={e => setSmtpUser(e.target.value)}
              placeholder="Username (optional)"
              className="bg-white/10 border border-white/20 text-white placeholder:text-white
                         rounded-xl px-4 py-3 w-full outline-none focus:border-white/50 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-fc-blue"
            />
            <input
              type="password"
              value={smtpPassword}
              onChange={e => setSmtpPassword(e.target.value)}
              placeholder="Password"
              autoComplete="new-password"
              className="bg-white/10 border border-white/20 text-white placeholder:text-white
                         rounded-xl px-4 py-3 w-full outline-none focus:border-white/50 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-fc-blue"
            />
            <select
              value={smtpTls}
              onChange={e => setSmtpTls(e.target.value)}
              className="bg-white/95 border border-white/30 text-gray-900 rounded-xl px-4 py-3 w-full"
            >
              <option value="true">Use TLS</option>
              <option value="false">No TLS</option>
            </select>
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-white text-fc-blue font-bold text-lg py-4 px-6 rounded-xl shadow-md
                         hover:bg-gray-100 active:bg-gray-200 transition-colors disabled:opacity-50"
            >
              {busy ? "Finishing…" : "Save and finish"}
            </button>
            <button
              type="button"
              onClick={skipSmtp}
              disabled={busy}
              className="text-white text-sm underline text-center py-2"
            >
              Skip for now
            </button>
          </form>
        )}
      </div>
    </main>
  )
}

export default function SetupPage() {
  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Welcome to FamilyChart" minimal />
      <Suspense fallback={null}>
        <SetupContent />
      </Suspense>
      <AppFooter />
    </div>
  )
}
