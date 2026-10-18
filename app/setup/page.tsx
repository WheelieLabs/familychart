// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import AuthenticatorEnrolment from "@/components/AuthenticatorEnrolment"
import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { disabledWhen } from "@/lib/ui/disabled-props"
import { signIn } from "next-auth/react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import AuthShell, { AuthCard, PasswordField } from "@/components/AuthShell"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import { FileInput, Input, Select } from "@/components/ui/controls"
import DateEcho from "@/components/ui/DateEcho"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import FormField from "@/components/ui/FormField"
import PageContainer from "@/components/ui/PageContainer"
import { getDeviceTimeZone } from "@/lib/date-format"
import { IANA_TIMEZONES, PASSWORD_MIN_LENGTH_FALLBACK } from "@/lib/settings/registry"
import type { SetupStepKey, SetupWizardContext } from "@/lib/setup-gate"
import { useMfaEnrollment } from "@/lib/use-mfa-enrollment"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const STEP_LABELS: Record<SetupStepKey, string> = {
  account: "Account",
  mfa: "Authenticator",
  person: "Person",
  timezone: "Timezone",
  smtp: "Email",
}

/** Same width as restore and Import Records: below 1024px the entry is not shown. */
function useDesktopViewport(): boolean {
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    const read = () => setDesktop(window.innerWidth >= 1024)
    read()
    window.addEventListener("resize", read)
    return () => window.removeEventListener("resize", read)
  }, [])
  return desktop
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const STEP_HEADINGS: Record<SetupStepKey, { heading: string; sub?: string }> = {
  account: { heading: "Create admin account" },
  mfa: { heading: "Set up an authenticator", sub: "This instance requires a second sign-in step. Set it up now before continuing." },
  person: { heading: "Add your first person", sub: "You can add more family members later from Management." },
  timezone: { heading: "Household timezone", sub: "Confirm your timezone for medication and observation reminders." },
  smtp: { heading: "Outbound email (optional)", sub: "Configure SMTP now or skip and set it later under System Settings." },
}

function SetupContent() {
  const router = useRouter()
  const desktop = useDesktopViewport()
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
  const [photoFile, setPhotoFile] = useState<File | null>(null)
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
      setTimezone(getDeviceTimeZone())
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

  async function handlePhotoSelect(file: File | null) {
    setPhotoFile(file)
    if (!file) {
      setPreviewUrl(null)
      setPhotoUrl(null)
      return
    }
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
    const passwordMinLength = wizard?.passwordMinLength ?? PASSWORD_MIN_LENGTH_FALLBACK
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
      <PageContainer>
        <EmptyState
          icon={EMPTY_STATE_ICONS.error}
          heading="Could not load setup"
          action={<Button onClick={refreshWizard}>Try again</Button>}
        >
          {loadError}. If this persists, check that the server is running and that /api/health reports the database as connected.
        </EmptyState>
      </PageContainer>
    )
  }

  if (!wizard) {
    return (
      <PageContainer>
        <p className="fc-admin-note">Loading setup…</p>
      </PageContainer>
    )
  }

  const accountSignInOnly = stepKey === "account" && !wizard.bootstrapAllowed
  const passwordMinLength = wizard.passwordMinLength ?? PASSWORD_MIN_LENGTH_FALLBACK
  const headings = accountSignInOnly
    ? { heading: "Sign in to continue", sub: "An administrator must sign in before configuring this instance." }
    : STEP_HEADINGS[stepKey]
  const stepNumber = stepIndex + 1
  const stepTotal = wizard.displaySteps.length

  return (
    <AuthShell heading={headings.heading} subheading={headings.sub}>
      <div className="fc-wizard">
        <p className="fc-auth__sub" aria-live="polite">
          <strong>Step {stepNumber} of {stepTotal}</strong> · {STEP_LABELS[stepKey]}
        </p>
        <ol className="fc-wizard__steps" aria-label="Setup steps">
          {wizard.displaySteps.map((s, i) => (
            <li key={s} aria-current={stepIndex === i ? "step" : undefined}
              className={`fc-wizard__step${stepIndex >= i ? " fc-wizard__step--on" : ""}`}>
              <span className="fc-wizard__num" aria-hidden="true">{i + 1}</span>
              <span className="fc-wizard__label">{STEP_LABELS[s]}</span>
            </li>
          ))}
        </ol>
        <p className="fc-auth__fine">
          FamilyChart helps you track medications and health observations for everyone in your household:
          dose history, timing rules and recurring checks in one place.{" "}
          {wizard.mode === "managed"
            ? "Add your first person and confirm your household timezone to finish provisioning."
            : "Your dashboard highlights what needs attention so you can stay on top of care."}
        </p>
      </div>

      {stepKey === "account" && accountSignInOnly && (
        <AuthCard>
          {error && <Banner kind="error">{error}</Banner>}
          {wizard.entraSignInAvailable && (
            <Button fullWidth onClick={() => signIn("microsoft-entra-id", { callbackUrl: "/setup" })}>
              Sign in with Microsoft
            </Button>
          )}
          <Button variant="secondary" fullWidth href="/login?callbackUrl=%2Fsetup">Sign in with local credentials</Button>
        </AuthCard>
      )}

      {stepKey === "account" && !accountSignInOnly && (
        <AuthCard onSubmit={handleStepAccount}>
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
          <FormField label="Email address">
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
          </FormField>
          <Button type="submit" fullWidth pending={busy} pendingLabel="Please wait…">Continue</Button>
          {wizard.entraSignInAvailable && (
            <Button variant="quiet" onClick={() => signIn("microsoft-entra-id", { callbackUrl: "/setup" })}>
              Already have a Microsoft admin account? Sign in
            </Button>
          )}
        </AuthCard>
      )}

      {stepKey === "mfa" && (
        !mfa.otpauth ? (
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
        )
      )}

      {stepKey === "person" && (
        <AuthCard onSubmit={handleStepPerson}>
          {error && <Banner kind="error">{error}</Banner>}
          <FormField label="Photo" optional hint="JPEG, PNG, WebP or GIF.">
            <div className="fc-photo-row">
              <div className="fc-photo-row__avatar">
                {previewUrl || photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl ?? photoUrl ?? ""} alt="" />
                ) : (
                  <span aria-hidden="true">{initials(personName || "?")}</span>
                )}
              </div>
              <FileInput
                accept="image/jpeg,image/png,image/webp,image/gif"
                file={photoFile}
                onFileChange={file => void handlePhotoSelect(file)}
              />
            </div>
            {uploading && <p className="fc-field__hint" role="status">Uploading…</p>}
          </FormField>
          <FormField label="Full name">
            <Input type="text" value={personName} onChange={e => setPersonName(e.target.value)} />
          </FormField>
          <FormField label="Date of birth">
            <Input type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} />
            <DateEcho date={dateOfBirth} />
          </FormField>
          <Button type="submit" fullWidth pending={busy}>Save and continue</Button>
          <Button variant="quiet" onClick={skipPerson}>Skip for now</Button>
          {desktop && (
            <Button variant="quiet" href="/admin/export?tab=restore">Restore from an export instead</Button>
          )}
        </AuthCard>
      )}

      {stepKey === "timezone" && (
        <AuthCard onSubmit={handleStepTimezone}>
          {error && <Banner kind="error">{error}</Banner>}
          <FormField label="Timezone" hint="Start typing to search, e.g. Australia/Sydney.">
            <Input
              type="text"
              list="setup-iana-tz-list"
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              disabled={busy}
              required
              placeholder="e.g. Australia/Sydney"
            />
            <datalist id="setup-iana-tz-list">
              {IANA_TIMEZONES.map(tz => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </FormField>
          <Button type="submit" fullWidth pending={busy}>
            {wizard.steps.includes("smtp") ? "Continue" : "Go to FamilyChart"}
          </Button>
        </AuthCard>
      )}

      {stepKey === "smtp" && (
        <AuthCard onSubmit={handleStepSmtp}>
          {error && <Banner kind="error">{error}</Banner>}
          <FormField label="SMTP host">
            <Input type="text" value={smtpHost} onChange={e => setSmtpHost(e.target.value)} placeholder="smtp.example.com" />
          </FormField>
          <FormField label="Port" hint="587 is the usual port.">
            <Input type="number" value={smtpPort} onChange={e => setSmtpPort(e.target.value)} />
          </FormField>
          <FormField label="Username" optional>
            <Input type="text" value={smtpUser} onChange={e => setSmtpUser(e.target.value)} autoComplete="off" />
          </FormField>
          <PasswordField
            label="Password"
            value={smtpPassword}
            onChange={setSmtpPassword}
            autoComplete="new-password"
            required={false}
          />
          <FormField label="Connection security">
            <Select value={smtpTls} onChange={e => setSmtpTls(e.target.value)}>
              <option value="true">Use TLS</option>
              <option value="false">No TLS</option>
            </Select>
          </FormField>
          <Button type="submit" fullWidth pending={busy} pendingLabel="Finishing…">Save and finish</Button>
          <Button variant="quiet" onClick={skipSmtp} {...disabledWhen(busy && "Finishing setup…")}>Skip for now</Button>
        </AuthCard>
      )}
    </AuthShell>
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
