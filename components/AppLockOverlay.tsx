// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import AppFooter from "@/components/AppFooter"
import AppHeader from "@/components/AppHeader"
import { useFocusTrap } from "@/components/Modal"
import { mainContentTargetProps } from "@/lib/a11y"
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
  clearLegacyBiometricCredentialId,
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

/** Query flag marking a return from the Microsoft re-auth started on the lock screen. */
const LOCK_SCREEN_OPT_OUT_PARAM = "appLockOptOut"

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
  const [reauthPassword, setReauthPassword] = useState("")
  const [reauthOtp, setReauthOtp] = useState("")
  const [needsOtp, setNeedsOtp] = useState(false)
  const [reauthErr, setReauthErr] = useState("")
  const [reauthBusy, setReauthBusy] = useState(false)
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
  // amount of retrying can succeed. Give a way out of that dead end.
  const resetCredential = useCallback((): void => {
    clearBiometricCredentialId(localStorage, userId)
    setStoredId(null)
    setError(null)
    setDidReset(true)
  }, [userId])

  const offerOptOut = shouldOfferAppLockOptOut({ consecutiveFailures, setupAfterResetFailed })

  const requestReauthGrant = useCallback(async (): Promise<boolean> => {
    setReauthBusy(true)
    setReauthErr("")
    try {
      const res = await fetch("/api/me/app-lock/reauth-grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isLocalAccount ? { password: reauthPassword, otp: reauthOtp } : {}),
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

  const confirmTurnOff = useCallback(async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (await requestReauthGrant()) onDisableAppLock()
  }, [requestReauthGrant, onDisableAppLock])

  const confirmWithMicrosoft = useCallback((): void => {
    const url = new URL(window.location.href)
    url.searchParams.set(LOCK_SCREEN_OPT_OUT_PARAM, "1")
    void signIn(
      "microsoft-entra-id",
      { callbackUrl: url.pathname + url.search },
      { prompt: "login", max_age: "0" },
    )
  }, [])

  // Returning from confirmWithMicrosoft's forced-fresh-login redirect: the session now carries
  // a fresh sign-in time, so finish turning App lock off.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get(LOCK_SCREEN_OPT_OUT_PARAM) !== "1") return
    url.searchParams.delete(LOCK_SCREEN_OPT_OUT_PARAM)
    window.history.replaceState(null, "", url.pathname + url.search + url.hash)
    void (async () => {
      if (await requestReauthGrant()) onDisableAppLock()
      else setOptOutStep("reauth")
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasCredential =
    typeof storedId === "string"
    && storedId.length > 0
    && base64urlToUint8Array(storedId) !== null

  const setupMode = storedIdResolved && !hasCredential

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
      <h2 id={titleId} className="sr-only">FamilyChart is locked</h2>
      <div
        className="flex h-full flex-col overflow-hidden [&>*]:min-h-0"
        style={shellPadding}
      >
        <AppHeader title="FamilyChart" minimal />
        <main {...mainContentTargetProps} className="fc-surface-app fc-scroll flex min-h-0 flex-1 flex-col">
          {!storedIdResolved ? (
            <div className="flex flex-1 flex-col justify-center px-4 py-6">
              <p className="text-center text-sm text-white/90">One moment…</p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col justify-center gap-4 px-4 py-6">
              <p className="text-center text-sm text-white/90">
                {unlocking ? "Unlocking…" : "FamilyChart is locked."}
              </p>
              {error != null && error !== "" && (
                <p className="text-center text-sm text-red-300">{error}</p>
              )}
              {unlocking && (
                <button
                  type="button"
                  className="mx-auto w-full max-w-xs rounded-xl px-4 py-2 text-center text-sm font-semibold text-white/80 underline hover:text-white"
                  onClick={cancelCeremony}
                >
                  Cancel
                </button>
              )}
              {!unlocking && setupMode && (
                <button
                  type="button"
                  className="mx-auto w-full max-w-xs rounded-xl bg-fc-blue-mid px-4 py-4 text-center text-sm font-bold text-white hover:bg-fc-blue-dark"
                  onClick={runSetup}
                >
                  Set up App lock
                </button>
              )}
              {!unlocking && hasCredential && (
                <button
                  type="button"
                  className="mx-auto w-full max-w-xs rounded-xl bg-fc-blue-mid px-4 py-4 text-center text-sm font-bold text-white hover:bg-fc-blue-dark"
                  onClick={runUnlock}
                >
                  {error != null && error !== "" ? "Try again" : "Unlock with your device"}
                </button>
              )}
              {!unlocking && hasCredential && error != null && error !== "" && (
                <button
                  type="button"
                  className="mx-auto w-full max-w-xs rounded-xl px-4 py-2 text-center text-sm font-semibold text-white/80 underline hover:text-white"
                  onClick={resetCredential}
                >
                  Still not working? Reset and set up again
                </button>
              )}
              {!unlocking && offerOptOut && optOutStep === "idle" && (
                <button
                  type="button"
                  className="mx-auto w-full max-w-xs rounded-xl px-4 py-2 text-center text-sm font-semibold text-white/80 underline hover:text-white"
                  onClick={() => setOptOutStep("confirm")}
                >
                  Turn off App lock on this device
                </button>
              )}
              {!unlocking && optOutStep === "confirm" && (
                <div className="mx-auto flex w-full max-w-xs flex-col gap-2 rounded-xl bg-white/10 p-3">
                  <p className="text-sm font-semibold text-white">Turn off App lock on this device?</p>
                  <p className="text-xs text-white/70">
                    Anyone who picks up this device while you&rsquo;re signed in will be able to open
                    FamilyChart and see your household&rsquo;s health records. You&rsquo;ll need to confirm
                    it&rsquo;s you first, and you can turn App lock back on from Profile → Account.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white/80 underline"
                      onClick={() => setOptOutStep("idle")}
                    >
                      Keep App lock
                    </button>
                    <button
                      type="button"
                      className="flex-1 rounded-lg bg-white px-3 py-2 text-sm font-bold text-gray-800"
                      onClick={() => setOptOutStep("reauth")}
                    >
                      Continue
                    </button>
                  </div>
                </div>
              )}
              {!unlocking && optOutStep === "reauth" && (
                <div className="mx-auto flex w-full max-w-xs flex-col gap-2 rounded-xl bg-white/10 p-3">
                  <p className="text-sm text-white/90">Confirm it&rsquo;s you to turn off App lock.</p>
                  {isLocalAccount ? (
                    <form onSubmit={confirmTurnOff} className="flex flex-col gap-2">
                      <input
                        type="password"
                        value={reauthPassword}
                        onChange={(e) => setReauthPassword(e.target.value)}
                        required
                        autoComplete="current-password"
                        placeholder="Current password"
                        aria-label="Current password"
                        className="rounded-lg px-3 py-2 text-sm text-gray-900"
                      />
                      {needsOtp && (
                        <input
                          type="text"
                          inputMode="numeric"
                          value={reauthOtp}
                          onChange={(e) => setReauthOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          required
                          placeholder="Authenticator code"
                          aria-label="Authenticator code"
                          className="rounded-lg px-3 py-2 text-center text-sm tracking-widest text-gray-900"
                        />
                      )}
                      {reauthErr && <p className="text-sm text-red-300">{reauthErr}</p>}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white/80 underline"
                          onClick={() => setOptOutStep("idle")}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={reauthBusy}
                          className="flex-1 rounded-lg bg-white px-3 py-2 text-sm font-bold text-gray-800 disabled:opacity-50"
                        >
                          {reauthBusy ? "…" : "Confirm"}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {reauthErr && <p className="text-sm text-red-300">{reauthErr}</p>}
                      <button
                        type="button"
                        className="rounded-lg bg-white px-3 py-2 text-sm font-bold text-gray-800"
                        onClick={confirmWithMicrosoft}
                      >
                        Sign in with Microsoft to confirm
                      </button>
                      <button
                        type="button"
                        className="rounded-lg px-3 py-2 text-sm font-semibold text-white/80 underline"
                        onClick={() => setOptOutStep("idle")}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button
                type="button"
                className="mx-auto w-full max-w-xs rounded-xl px-4 py-2 text-center text-sm font-semibold text-white/60 underline hover:text-white"
                onClick={() => {
                  clearLegacyBiometricCredentialId(localStorage)
                  void signOut({ callbackUrl: "/login" })
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </main>
        <AppFooter showDiagnostics={false} />
      </div>
    </div>
  )
}
