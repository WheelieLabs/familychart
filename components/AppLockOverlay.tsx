// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import AppFooter from "@/components/AppFooter"
import AppHeader from "@/components/AppHeader"
import { useFocusTrap } from "@/components/Modal"
import { PasswordField } from "@/components/AuthShell"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import { Input } from "@/components/ui/controls"
import FormField from "@/components/ui/FormField"
import PageContainer from "@/components/ui/PageContainer"
import Panel from "@/components/ui/Panel"
import { parseLocalAccountUid } from "@/lib/account/account-uid"
import { shouldOfferAppLockOptOut } from "@/lib/app-lock-opt-out"
import { signIn, signOut } from "next-auth/react"
import {
  base64urlToUint8Array,
  bufferToBase64url,
  buildCreateOptions,
  buildGetOptions,
  buildWebAuthnFailureReport,
  clearBiometricCredentialId,
  describeWebAuthnError,
  getWebAuthnAdapter,
  readBiometricCredentialId,
  withWebAuthnTimeout,
  writeBiometricCredentialId,
  type WebAuthnCeremonyPhase,
} from "@/lib/webauthn-app-lock"
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react"

type Props = {
  userId: string
  onUnlocked: () => void
  /** Device-local escape hatch for a device whose WebAuthn can never
   * succeed — see lib/bio-lock-state.ts's isAppLockDisabled. Only called after a fresh
   * re-auth grant (ADR-0016). */
  onDisableAppLock: () => void
}

// The WebAuthn spec timeout requested in buildCreateOptions/buildGetOptions is 60s. This is
// a safety net just above it (ADR-0016) for a promise that never settles at all — observed
// on some Android/Chrome combinations when the platform ignores AbortSignal. A real ceremony
// resolves in a second or two; a visible Cancel covers the case where the user wants out
// sooner than either of these.
const WEBAUTHN_SAFETY_NET_MS = 65_000

/** Query flag marking a return from the Microsoft re-auth started on the lock screen. Its value
 * says what the re-proof was for. */
const LOCK_SCREEN_OPT_OUT_PARAM = "appLockOptOut"
const RETURN_FOR_TURN_OFF = "1"
const RETURN_FOR_RESET = "reset"
const RETURN_FOR_SETUP = "setup"

/** What the lock screen's re-proof panel does once the server accepts it (ADR-0016). */
type ReauthPurpose = "turn-off" | "reset" | "setup"

function reportWebAuthnFailure(phase: WebAuthnCeremonyPhase, error: unknown, startedAtMs: number): void {
  const report = buildWebAuthnFailureReport(
    phase,
    error,
    Date.now() - startedAtMs,
    typeof navigator === "undefined" ? "" : navigator.userAgent,
  )
  try {
    void fetch("/api/me/app-lock/failure-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
      keepalive: true,
    })
  } catch {
    /* best-effort only */
  }
}

export default function AppLockOverlay({ userId, onUnlocked, onDisableAppLock }: Props) {
  const [storedIdResolved, setStoredIdResolved] = useState(false)
  const [storedId, setStoredId] = useState<string | null>(null)
  const [unlocking, setUnlocking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [consecutiveFailures, setConsecutiveFailures] = useState(0)
  const [didReset, setDidReset] = useState(false)
  const [setupAfterResetFailed, setSetupAfterResetFailed] = useState(false)
  const [optOutStep, setOptOutStep] = useState<"idle" | "confirm" | "reauth">("idle")
  const [reauthPurpose, setReauthPurpose] = useState<ReauthPurpose>("turn-off")
  const [reauthPassword, setReauthPassword] = useState("")
  const [reauthOtp, setReauthOtp] = useState("")
  const [needsOtp, setNeedsOtp] = useState(false)
  const [reauthErr, setReauthErr] = useState("")
  const [reauthBusy, setReauthBusy] = useState(false)
  // Set-up on this device needs a server grant too (ADR-0016): a recent sign-in, or re-proof.
  const [setupGranted, setSetupGranted] = useState(false)
  const [setupChecked, setSetupChecked] = useState(false)
  const setupCheckStartedRef = useRef(false)
  const returnedFromMicrosoftRef = useRef(false)
  const isLocalAccount = parseLocalAccountUid(userId) != null
  const cancelControllerRef = useRef<AbortController | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useFocusTrap(dialogRef, true)

  useLayoutEffect(() => {
    setStoredId(readBiometricCredentialId(localStorage, userId))
    setStoredIdResolved(true)
  }, [userId])

  const persistCredentialRawId = useCallback((rawId: ArrayBuffer): void => {
    try {
      writeBiometricCredentialId(localStorage, userId, bufferToBase64url(rawId))
    } catch {
      throw new Error("Could not save App lock on this device.")
    }
  }, [userId])

  const cancelCeremony = useCallback((): void => {
    cancelControllerRef.current?.abort()
  }, [])

  const recordSetupFailure = useCallback((): void => {
    setConsecutiveFailures((n) => n + 1)
    if (didReset) setSetupAfterResetFailed(true)
  }, [didReset])

  const runSetup = useCallback(async (): Promise<void> => {
    setError(null)
    if (typeof navigator === "undefined" || !navigator.credentials) {
      setError("This device cannot use App lock in the browser.")
      return
    }
    if (typeof PublicKeyCredential === "undefined") {
      setError("WebAuthn is not available in this browser.")
      return
    }

    const options = buildCreateOptions(userId, window.location.hostname)
    const cancelController = new AbortController()
    cancelControllerRef.current = cancelController
    const startedAt = Date.now()

    setUnlocking(true)
    try {
      const result = await withWebAuthnTimeout(
        (signal) => getWebAuthnAdapter().create(options, signal),
        WEBAUTHN_SAFETY_NET_MS,
        "Setup timed out — try again.",
        { cancelSignal: cancelController.signal, cancelMessage: "Setup cancelled." },
      )
      if (!result) {
        setError("Could not complete App lock setup.")
        recordSetupFailure()
        return
      }

      // create() succeeding isn't sufficient evidence this device can
      // actually use the credential: get() has been observed to fail
      // instantly and permanently on some Android/Chrome combinations even
      // for a credential just created successfully, which otherwise leaves
      // the user stuck in an unlock-fails / reset-and-repeat loop forever.
      // Prove the round trip now, before trusting and persisting it.
      const verifyOptions = buildGetOptions(new Uint8Array(result.rawId), window.location.hostname)
      const verifyCancelController = new AbortController()
      cancelControllerRef.current = verifyCancelController
      const verified = await withWebAuthnTimeout(
        (signal) => getWebAuthnAdapter().get(verifyOptions, signal),
        WEBAUTHN_SAFETY_NET_MS,
        "Could not confirm the new credential works on this device — try again.",
        { cancelSignal: verifyCancelController.signal, cancelMessage: "Setup cancelled." },
      )
      if (!verified) {
        setError(
          "This device created a credential but could not verify it. Try again.",
        )
        recordSetupFailure()
        reportWebAuthnFailure("verify", new Error("Verification returned no result"), startedAt)
        return
      }

      persistCredentialRawId(result.rawId)
      onUnlocked()
    } catch (e: unknown) {
      setError(describeWebAuthnError(e, "Setup failed — try again."))
      // A user-initiated Cancel is not a device failure and must not count toward the opt-out.
      if (!cancelController.signal.aborted) {
        recordSetupFailure()
        reportWebAuthnFailure("create", e, startedAt)
      }
    } finally {
      cancelControllerRef.current = null
      setUnlocking(false)
    }
  }, [onUnlocked, persistCredentialRawId, userId, recordSetupFailure])

  const runUnlock = useCallback(async (): Promise<void> => {
    setError(null)
    if (!storedId) {
      setError("No App lock credential is configured.")
      return
    }
    if (typeof navigator === "undefined" || !navigator.credentials) {
      setError("This device cannot use App lock in the browser.")
      return
    }
    if (typeof PublicKeyCredential === "undefined") {
      setError("WebAuthn is not available in this browser.")
      return
    }

    const credentialId = base64urlToUint8Array(storedId)
    if (!credentialId || credentialId.byteLength === 0) {
      setError("Stored credential is invalid. Set up App lock again.")
      return
    }

    const options = buildGetOptions(credentialId, window.location.hostname)
    const cancelController = new AbortController()
    cancelControllerRef.current = cancelController
    const startedAt = Date.now()

    setUnlocking(true)
    try {
      const result = await withWebAuthnTimeout(
        (signal) => getWebAuthnAdapter().get(options, signal),
        WEBAUTHN_SAFETY_NET_MS,
        "Unlock timed out — try again.",
        { cancelSignal: cancelController.signal, cancelMessage: "Unlock cancelled." },
      )
      if (result) {
        onUnlocked()
      } else {
        setError("Could not verify App lock — try again.")
        setConsecutiveFailures((n) => n + 1)
      }
    } catch (e: unknown) {
      setError(describeWebAuthnError(e, "Unlock failed — try again."))
      if (!cancelController.signal.aborted) {
        setConsecutiveFailures((n) => n + 1)
        reportWebAuthnFailure("get", e, startedAt)
      }
    } finally {
      cancelControllerRef.current = null
      setUnlocking(false)
    }
  }, [storedId, onUnlocked])

  // Some platforms permanently invalidate the stored credential outside the
  // app's control — e.g. Android drops every platform passkey when the
  // device's lock-screen credential changes or biometrics are re-enrolled.
  // get() then rejects instantly, never even reaching the sensor, and no
  // amount of retrying can succeed. Give a way out of that dead end, but only after the
  // server has accepted a fresh re-proof (ADR-0016): clearing the id opens set-up, and set-up
  // unlocks, so an unproven reset would let anyone past the device check replace the credential.
  const resetCredential = useCallback((): void => {
    clearBiometricCredentialId(localStorage, userId)
    setStoredId(null)
    setError(null)
    setDidReset(true)
    setSetupGranted(true)
  }, [userId])

  const offerOptOut = shouldOfferAppLockOptOut({ consecutiveFailures, setupAfterResetFailed })

  const requestReauthGrant = useCallback(async (bodyOverride?: Record<string, unknown>): Promise<boolean> => {
    setReauthBusy(true)
    setReauthErr("")
    try {
      const res = await fetch("/api/me/app-lock/reauth-grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          bodyOverride ?? (isLocalAccount ? { password: reauthPassword, otp: reauthOtp } : {}),
        ),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message = typeof j.error === "string" ? j.error : "Could not confirm it's you."
        if (message === "Authenticator code is required") setNeedsOtp(true)
        setReauthErr(message)
        return false
      }
      return true
    } finally {
      setReauthBusy(false)
    }
  }, [isLocalAccount, reauthPassword, reauthOtp])

  const finishReauth = useCallback((purpose: ReauthPurpose): void => {
    if (purpose === "reset") resetCredential()
    else if (purpose === "setup") setSetupGranted(true)
    else onDisableAppLock()
  }, [resetCredential, onDisableAppLock])

  const startReauth = useCallback((purpose: ReauthPurpose): void => {
    setReauthPurpose(purpose)
    setReauthErr("")
    setReauthPassword("")
    setReauthOtp("")
    setOptOutStep("reauth")
  }, [])

  const cancelReauth = useCallback((): void => {
    setReauthPassword("")
    setReauthOtp("")
    setReauthErr("")
    setOptOutStep("idle")
  }, [])

  const confirmReauth = useCallback(async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (await requestReauthGrant()) {
      setOptOutStep("idle")
      setReauthPassword("")
      setReauthOtp("")
      finishReauth(reauthPurpose)
    }
  }, [requestReauthGrant, finishReauth, reauthPurpose])

  const confirmWithMicrosoft = useCallback((): void => {
    const url = new URL(window.location.href)
    url.searchParams.set(
      LOCK_SCREEN_OPT_OUT_PARAM,
      reauthPurpose === "reset"
        ? RETURN_FOR_RESET
        : reauthPurpose === "setup"
          ? RETURN_FOR_SETUP
          : RETURN_FOR_TURN_OFF,
    )
    void signIn(
      "microsoft-entra-id",
      { callbackUrl: url.pathname + url.search },
      { prompt: "login", max_age: "0" },
    )
  }, [reauthPurpose])

  // Returning from confirmWithMicrosoft's forced-fresh-login redirect: the session now carries
  // a fresh sign-in time, so finish what the re-proof was for (turning App lock off, or
  // resetting the credential).
  useEffect(() => {
    const url = new URL(window.location.href)
    const returnedFor = url.searchParams.get(LOCK_SCREEN_OPT_OUT_PARAM)
    if (
      returnedFor !== RETURN_FOR_TURN_OFF
      && returnedFor !== RETURN_FOR_RESET
      && returnedFor !== RETURN_FOR_SETUP
    ) return
    returnedFromMicrosoftRef.current = true
    const purpose: ReauthPurpose =
      returnedFor === RETURN_FOR_RESET ? "reset" : returnedFor === RETURN_FOR_SETUP ? "setup" : "turn-off"
    url.searchParams.delete(LOCK_SCREEN_OPT_OUT_PARAM)
    window.history.replaceState(null, "", url.pathname + url.search + url.hash)
    void (async () => {
      if (await requestReauthGrant()) finishReauth(purpose)
      else {
        setReauthPurpose(purpose)
        setOptOutStep("reauth")
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- consume opt-out URL param once on mount
  }, [])

  const hasCredential =
    typeof storedId === "string"
    && storedId.length > 0
    && base64urlToUint8Array(storedId) !== null

  const setupMode = storedIdResolved && !hasCredential

  // First set-up (or a cleared-storage / credential-version-bump device) needs the same
  // server-verified grant as a reset, unless the user password-signed-in recently, which the
  // server decides. Ask once; if refused, show the re-proof panel instead of the set-up button.
  useEffect(() => {
    if (!setupMode || setupGranted || setupCheckStartedRef.current) return
    setupCheckStartedRef.current = true
    if (returnedFromMicrosoftRef.current) {
      setSetupChecked(true)
      return
    }
    void (async () => {
      const granted = await requestReauthGrant(isLocalAccount ? { recentSignIn: true } : {})
      setReauthErr("")
      if (granted) setSetupGranted(true)
      else startReauth("setup")
      setSetupChecked(true)
    })()
  }, [setupMode, setupGranted, isLocalAccount, requestReauthGrant, startReauth])

  // Auto-trigger biometric once the credential check resolves, but only when
  // the page has focus — navigator.credentials.get() throws if it doesn't.
  useEffect(() => {
    if (!storedIdResolved || !hasCredential) return
    if (document.hasFocus()) {
      runUnlock()
    } else {
      const onFocus = () => runUnlock()
      window.addEventListener("focus", onFocus, { once: true })
      return () => window.removeEventListener("focus", onFocus)
    }
  }, [storedIdResolved, hasCredential, runUnlock])

  const shellPadding = {
    paddingTop: "calc(env(safe-area-inset-top, 0px))",
    paddingBottom: "calc(env(safe-area-inset-bottom, 0px))",
    paddingLeft: "calc(env(safe-area-inset-left, 0px))",
    paddingRight: "calc(env(safe-area-inset-right, 0px))",
  } as const

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[200]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-live="polite"
    >
      <h2 id={titleId} className="fc-visually-hidden">FamilyChart is locked</h2>
      <div
        className="flex h-full flex-col overflow-hidden [&>*]:min-h-0"
        style={shellPadding}
      >
        <AppHeader title="FamilyChart" minimal />
        <PageContainer width="narrow">
          {!storedIdResolved ? (
            <p className="fc-admin-note">One moment…</p>
          ) : (
            <>
              <p className="fc-admin-note">{unlocking ? "Unlocking…" : "FamilyChart is locked."}</p>
              {error != null && error !== "" && <Banner kind="error">{error}</Banner>}
              {unlocking && (
                <Button variant="quiet" onClick={cancelCeremony}>Cancel</Button>
              )}
              {!unlocking && setupMode && setupGranted && (
                <Button fullWidth onClick={runSetup}>Set up App lock</Button>
              )}
              {!unlocking && setupMode && !setupGranted && setupChecked && optOutStep === "idle" && (
                <Button fullWidth onClick={() => startReauth("setup")}>Confirm it&rsquo;s you to set up App lock</Button>
              )}
              {!unlocking && hasCredential && (
                <Button fullWidth onClick={runUnlock}>
                  {error != null && error !== "" ? "Try again" : "Unlock with your device"}
                </Button>
              )}
              {!unlocking && hasCredential && error != null && error !== "" && (
                <Button variant="quiet" onClick={() => startReauth("reset")}>Still not working? Reset and set up again</Button>
              )}
              {!unlocking && offerOptOut && optOutStep === "idle" && (
                <Button variant="quiet" onClick={() => setOptOutStep("confirm")}>Turn off App lock on this device</Button>
              )}
              {!unlocking && optOutStep === "confirm" && (
                <Panel>
                  <h3 className="fc-section-title">Turn off App lock on this device?</h3>
                  <p className="fc-section-copy">
                    Anyone who picks up this device while you&rsquo;re signed in will be able to open
                    FamilyChart and see your household&rsquo;s health records. You&rsquo;ll need to confirm
                    it&rsquo;s you first, and you can turn App lock back on from Profile → Account.
                  </p>
                  <div className="fc-form-actions">
                    <Button variant="secondary" onClick={() => setOptOutStep("idle")}>Keep App lock</Button>
                    <Button onClick={() => startReauth("turn-off")}>Continue</Button>
                  </div>
                </Panel>
              )}
              {!unlocking && optOutStep === "reauth" && (
                <Panel>
                  <h3 className="fc-section-title">
                    {reauthPurpose === "reset"
                      ? "Confirm it’s you to set up App lock again."
                      : reauthPurpose === "setup"
                        ? "Confirm it’s you to set up App lock."
                        : "Confirm it’s you to turn off App lock."}
                  </h3>
                  {reauthPurpose === "reset" && (
                    <p className="fc-section-copy">
                      Setting up again replaces the App lock on this device, so we need your
                      {isLocalAccount ? " password" : " Microsoft sign-in"} first. This stops someone else who
                      can unlock this device from replacing your App lock while you&rsquo;re signed in.
                    </p>
                  )}
                  {reauthPurpose === "setup" && (
                    <p className="fc-section-copy">
                      It&rsquo;s been a little while since you signed in, so we need your
                      {isLocalAccount ? " password" : " Microsoft sign-in"} before setting up App lock on this
                      device. This stops someone else who can open this device from setting up App lock in your
                      name.
                    </p>
                  )}
                  {isLocalAccount ? (
                    <form onSubmit={confirmReauth} className="fc-form">
                      <PasswordField
                        label="Current password"
                        value={reauthPassword}
                        onChange={setReauthPassword}
                        autoComplete="current-password"
                      />
                      {needsOtp && (
                        <FormField label="Authenticator code" hint="6 digits.">
                          <Input
                            type="text"
                            inputMode="numeric"
                            value={reauthOtp}
                            onChange={(e) => setReauthOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                            required
                          />
                        </FormField>
                      )}
                      {reauthErr && <Banner kind="error">{reauthErr}</Banner>}
                      <div className="fc-form-actions">
                        <Button variant="secondary" onClick={cancelReauth}>Cancel</Button>
                        <Button type="submit" pending={reauthBusy} pendingLabel="Confirming…">Confirm</Button>
                      </div>
                    </form>
                  ) : (
                    <div className="fc-form">
                      {reauthErr && <Banner kind="error">{reauthErr}</Banner>}
                      <Button onClick={confirmWithMicrosoft}>Sign in with Microsoft to confirm</Button>
                      <Button variant="secondary" onClick={cancelReauth}>Cancel</Button>
                    </div>
                  )}
                </Panel>
              )}
              <Button
                variant="quiet"
                onClick={() => {
                  void signOut({ callbackUrl: "/login" })
                }}
              >
                Sign out
              </Button>
            </>
          )}
        </PageContainer>
        <AppFooter showDiagnostics={false} />
      </div>
    </div>
  )
}
