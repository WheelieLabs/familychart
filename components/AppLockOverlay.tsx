// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import AppFooter from "@/components/AppFooter"
import AppHeader from "@/components/AppHeader"
import { useFocusTrap } from "@/components/Modal"
import { mainContentTargetProps } from "@/lib/a11y"
import { markAppLockSuppressed } from "@/lib/app-lock-navigation"
import {
  base64urlToUint8Array,
  bufferToBase64url,
  buildCreateOptions,
  buildGetOptions,
  clearBiometricCredentialId,
  describeWebAuthnError,
  getWebAuthnAdapter,
  isWebAuthnAlreadyPendingError,
  readBiometricCredentialId,
  withWebAuthnTimeout,
  writeBiometricCredentialId,
} from "@/lib/webauthn-app-lock"
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react"

type Props = {
  userId: string
  onUnlocked: () => void
  /** Device-local escape hatch for a device whose WebAuthn can never
   * succeed — see lib/bio-lock-state.ts's isAppLockDisabled. */
  onDisableAppLock: () => void
}

// A real biometric ceremony that's working resolves in a second or two.
// Keep this short: on the platforms that hang instead of prompting at all,
// a long timeout just means a longer stare at "Unlocking…" before the
// user gives up and force-closes the app — never reaching the retry button
// this timeout exists to surface.
const WEBAUTHN_TIMEOUT_MS = 8_000

export default function AppLockOverlay({ userId, onUnlocked, onDisableAppLock }: Props) {
  const [storedIdResolved, setStoredIdResolved] = useState(false)
  const [storedId, setStoredId] = useState<string | null>(null)
  const [unlocking, setUnlocking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set when the OS-level WebAuthn request is wedged (see
  // isWebAuthnAlreadyPendingError) — retrying in-app cannot help, so we hide
  // the retry button instead of sending the user into a doomed loop.
  const [requiresRestart, setRequiresRestart] = useState(false)
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
      throw new Error("Could not save password manager unlock on this device.")
    }
  }, [userId])

  const runSetup = useCallback(async (): Promise<void> => {
    setError(null)
    setRequiresRestart(false)
    if (typeof navigator === "undefined" || !navigator.credentials) {
      setError("This device cannot use password manager unlock in the browser.")
      return
    }
    if (typeof PublicKeyCredential === "undefined") {
      setError("WebAuthn is not available in this browser.")
      return
    }

    const options = buildCreateOptions(userId, window.location.hostname)

    setUnlocking(true)
    try {
      // A discoverable-credential ceremony (residentKey: "preferred") can
      // hand off to Android's Credential Manager UI, which backgrounds the
      // tab and returns — indistinguishable, to the visibilitychange
      // listener in lib/bio-lock-state.ts, from the user actually leaving.
      // Without suppressing it, that re-lock unmounts this overlay mid-
      // ceremony and its mount effect can fire a second, overlapping
      // credentials call, racing the one already in flight.
      markAppLockSuppressed(sessionStorage)
      const result = await withWebAuthnTimeout(
        (signal) => getWebAuthnAdapter().create(options, signal),
        WEBAUTHN_TIMEOUT_MS,
        "Setup timed out — try again.",
      )
      if (!result) {
        setError("Could not complete password manager unlock setup.")
        return
      }

      // create() succeeding isn't sufficient evidence this device can
      // actually use the credential: get() has been observed to fail
      // instantly and permanently on some Android/Chrome combinations even
      // for a credential just created successfully, which otherwise leaves
      // the user stuck in an unlock-fails / reset-and-repeat loop forever.
      // Prove the round trip now, before trusting and persisting it.
      const verifyOptions = buildGetOptions(new Uint8Array(result.rawId), window.location.hostname)
      markAppLockSuppressed(sessionStorage)
      const verified = await withWebAuthnTimeout(
        (signal) => getWebAuthnAdapter().get(verifyOptions, signal),
        WEBAUTHN_TIMEOUT_MS,
        "Could not confirm the new credential works on this device — try again.",
      )
      if (!verified) {
        setError(
          "This device created a credential but could not verify it. Try again, or disable password manager unlock below.",
        )
        return
      }

      persistCredentialRawId(result.rawId)
      onUnlocked()
    } catch (e: unknown) {
      if (isWebAuthnAlreadyPendingError(e)) {
        setRequiresRestart(true)
        setError("Password manager unlock setup is stuck on this device.")
      } else {
        setError(describeWebAuthnError(e, "Setup failed — try again."))
      }
    } finally {
      setUnlocking(false)
    }
  }, [onUnlocked, persistCredentialRawId, userId])

  const runUnlock = useCallback(async (): Promise<void> => {
    setError(null)
    setRequiresRestart(false)
    if (!storedId) {
      setError("No password manager credential is configured.")
      return
    }
    if (typeof navigator === "undefined" || !navigator.credentials) {
      setError("This device cannot use password manager unlock in the browser.")
      return
    }
    if (typeof PublicKeyCredential === "undefined") {
      setError("WebAuthn is not available in this browser.")
      return
    }

    const credentialId = base64urlToUint8Array(storedId)
    if (!credentialId || credentialId.byteLength === 0) {
      setError("Stored credential is invalid. Set up password manager unlock again.")
      return
    }

    const options = buildGetOptions(credentialId, window.location.hostname)

    setUnlocking(true)
    try {
      // See the matching comment in runSetup — the same backgrounding
      // happens on every unlock attempt too, not just first-time setup.
      markAppLockSuppressed(sessionStorage)
      const result = await withWebAuthnTimeout(
        (signal) => getWebAuthnAdapter().get(options, signal),
        WEBAUTHN_TIMEOUT_MS,
        "Unlock timed out — try again.",
      )
      if (result) {
        onUnlocked()
      } else {
        setError("Could not verify password manager unlock — try again.")
      }
    } catch (e: unknown) {
      if (isWebAuthnAlreadyPendingError(e)) {
        setRequiresRestart(true)
        setError("Password manager unlock is stuck on this device.")
      } else {
        setError(describeWebAuthnError(e, "Unlock failed — try again."))
      }
    } finally {
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
    setRequiresRestart(false)
  }, [userId])

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
              {requiresRestart && (
                <p className="text-center text-sm text-white/90">
                  Fully close FamilyChart — swipe it away in your app switcher,
                  don&rsquo;t just leave it in the background — then reopen it.
                  Tapping retry won&rsquo;t help until the app has been restarted.
                </p>
              )}
              {!unlocking && !requiresRestart && setupMode && (
                <button
                  type="button"
                  className="mx-auto w-full max-w-xs rounded-xl bg-fc-blue-mid px-4 py-4 text-center text-sm font-bold text-white hover:bg-fc-blue-dark"
                  onClick={runSetup}
                >
                  Set up password manager unlock
                </button>
              )}
              {!unlocking && !requiresRestart && hasCredential && (
                <button
                  type="button"
                  className="mx-auto w-full max-w-xs rounded-xl bg-fc-blue-mid px-4 py-4 text-center text-sm font-bold text-white hover:bg-fc-blue-dark"
                  onClick={runUnlock}
                >
                  {error != null && error !== "" ? "Try again" : "Unlock"}
                </button>
              )}
              {!unlocking && hasCredential && error != null && error !== "" && (
                <button
                  type="button"
                  className="mx-auto w-full max-w-xs rounded-xl px-4 py-2 text-center text-sm font-semibold text-white/80 underline hover:text-white"
                  onClick={resetCredential}
                >
                  Still not working? Reset password manager unlock
                </button>
              )}
              {!unlocking && error != null && error !== "" && (
                <div className="mx-auto flex w-full max-w-xs flex-col gap-1">
                  <button
                    type="button"
                    className="rounded-xl px-4 py-2 text-center text-sm font-semibold text-white/80 underline hover:text-white"
                    onClick={onDisableAppLock}
                  >
                    Turn off password manager unlock for this device
                  </button>
                  <p className="text-center text-xs text-white/60">
                    You&rsquo;ll go straight into FamilyChart on this device from now on.
                    Re-enable it anytime from Profile → Account.
                  </p>
                </div>
              )}
            </div>
          )}
        </main>
        <AppFooter />
      </div>
    </div>
  )
}
