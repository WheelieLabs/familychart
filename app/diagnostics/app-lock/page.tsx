// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useSession } from "next-auth/react"
import { useCallback, useEffect, useState } from "react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import { mainContentTargetProps } from "@/lib/a11y"
import {
  APP_LOCK_PROBE_SETS,
  describeAuthenticatorData,
  describeUserVerificationMethods,
  readAttestationFormat,
  type AppLockProbeKey,
  type AppLockProbeSet,
} from "@/lib/app-lock-diagnostics"
import { isAppLockSuppressed } from "@/lib/app-lock-navigation"
import { getAppLockGracePeriod, isAppLockDisabled } from "@/lib/bio-lock-state"
import {
  base64urlToUint8Array,
  biometricCredentialStorageKey,
  bufferToBase64url,
  describeWebAuthnError,
} from "@/lib/webauthn-app-lock"

const STORE_KEY = "fc_diag_app_lock_creds"
const PROVIDER_KEY = "fc_diag_app_lock_google_provider"

type StoredProbeCred = {
  id: string
  set: AppLockProbeKey
  googleProvider: string
  at: string
}

type DeviceState = {
  credentialStored: string
  versionMarker: string
  optedOut: string
  gracePeriod: string
  suppressed: string
}

function shortId(s: string): string {
  return s.length > 22 ? `${s.slice(0, 10)}…${s.slice(-8)}` : s
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

function readStoredCreds(): StoredProbeCred[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as StoredProbeCred[]) : []
  } catch {
    return []
  }
}

function writeStoredCreds(creds: StoredProbeCred[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(creds))
  } catch {
    /* ignore */
  }
}

function readDeviceState(userId: string): DeviceState {
  let credentialStored = "no"
  let versionMarker = "none"
  try {
    const raw = localStorage.getItem(biometricCredentialStorageKey(userId))
    if (raw) {
      credentialStored = "yes"
      try {
        const parsed: unknown = JSON.parse(raw)
        const v = (parsed as { v?: unknown } | null)?.v
        versionMarker = typeof v === "number" ? String(v) : "none (pre-marker record)"
      } catch {
        versionMarker = "none (pre-marker record)"
      }
    }
  } catch {
    /* ignore */
  }
  return {
    credentialStored,
    versionMarker,
    optedOut: isAppLockDisabled(localStorage, userId) ? "yes" : "no",
    gracePeriod: getAppLockGracePeriod(localStorage, userId),
    suppressed: isAppLockSuppressed(sessionStorage) ? "yes" : "no",
  }
}

export default function AppLockDiagnosticsPage() {
  const { data: session } = useSession()
  const userId = session?.user?.id ?? ""
  const [provider, setProvider] = useState("unknown")
  const [creds, setCreds] = useState<StoredProbeCred[]>([])
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [copied, setCopied] = useState(false)
  const [deviceState, setDeviceState] = useState<DeviceState | null>(null)

  useEffect(() => {
    setCreds(readStoredCreds())
    try {
      setProvider(localStorage.getItem(PROVIDER_KEY) ?? "unknown")
    } catch {
      /* ignore */
    }
    setLog([
      `Origin ${window.location.origin} | display-mode ${
        window.matchMedia("(display-mode: standalone)").matches ? "standalone (installed app)" : "browser tab"
      } | ${navigator.userAgent}`,
    ])
  }, [])

  useEffect(() => {
    if (userId) setDeviceState(readDeviceState(userId))
  }, [userId])

  const appendLog = useCallback((line: string) => {
    setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`])
  }, [])

  const changeProvider = (value: string): void => {
    setProvider(value)
    try {
      localStorage.setItem(PROVIDER_KEY, value)
    } catch {
      /* ignore */
    }
    appendLog(`Google provider marked ${value.toUpperCase()}`)
  }

  const runCreate = async (set: AppLockProbeSet): Promise<void> => {
    setBusy(true)
    const name = `diag-${set.key}-${Date.now().toString(36)}`
    appendLog(`${set.key} create (Google ${provider})…`)
    const started = performance.now()
    try {
      const cred = (await navigator.credentials.create({
        publicKey: set.create(randomBytes(32), window.location.hostname, randomBytes(16), name),
      })) as PublicKeyCredential | null
      const ms = Math.round(performance.now() - started)
      const response = cred?.response as AuthenticatorAttestationResponse | undefined
      if (!cred || !response) {
        appendLog(`${set.key} create: no credential (${ms}ms)`)
        return
      }
      const ext = cred.getClientExtensionResults?.() as { credProps?: { rk?: boolean } } | undefined
      let auth = "authData unavailable"
      try {
        auth = describeAuthenticatorData(response.getAuthenticatorData())
      } catch {
        /* ignore */
      }
      const id = bufferToBase64url(cred.rawId)
      appendLog(
        `${set.key} create OK ${ms}ms | ${auth} | fmt=${readAttestationFormat(response.attestationObject)} | rk=${
          ext?.credProps?.rk ?? "?"
        } | attachment=${cred.authenticatorAttachment ?? "?"} | transports=${
          response.getTransports?.().join(",") || "?"
        } | id=${shortId(id)}`,
      )
      const next = [
        ...readStoredCreds(),
        { id, set: set.key, googleProvider: provider, at: new Date().toISOString() },
      ]
      writeStoredCreds(next)
      setCreds(next)
    } catch (err) {
      appendLog(
        `${set.key} create FAILED after ${Math.round(performance.now() - started)}ms: ${describeWebAuthnError(err, "failed")}`,
      )
    } finally {
      setBusy(false)
    }
  }

  const runGet = async (stored: StoredProbeCred): Promise<void> => {
    const set = APP_LOCK_PROBE_SETS.find((s) => s.key === stored.set)
    const credId = base64urlToUint8Array(stored.id)
    if (!set || !credId) return
    setBusy(true)
    appendLog(
      `${stored.set} get ${shortId(stored.id)} (created Google ${stored.googleProvider}, now ${provider})…`,
    )
    const started = performance.now()
    try {
      const cred = (await navigator.credentials.get({
        publicKey: set.get(randomBytes(32), window.location.hostname, credId as Uint8Array<ArrayBuffer>),
      })) as PublicKeyCredential | null
      const ms = Math.round(performance.now() - started)
      const response = cred?.response as AuthenticatorAssertionResponse | undefined
      appendLog(
        cred && response
          ? `${stored.set} get OK ${ms}ms | ${describeAuthenticatorData(response.authenticatorData)} | uvm=${describeUserVerificationMethods(
              cred.getClientExtensionResults?.() as { uvm?: unknown } | undefined,
            )} | attachment=${cred.authenticatorAttachment ?? "?"}`
          : `${stored.set} get: empty result (${ms}ms)`,
      )
    } catch (err) {
      appendLog(
        `${stored.set} get FAILED after ${Math.round(performance.now() - started)}ms: ${describeWebAuthnError(err, "failed")}`,
      )
    } finally {
      setBusy(false)
    }
  }

  const clearCreds = (): void => {
    writeStoredCreds([])
    setCreds([])
    appendLog("Cleared stored diagnostic credential IDs (the credentials stay with their provider)")
  }

  const copyLog = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(log.join("\n"))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      appendLog("Copy failed: long-press the log to select it instead")
    }
  }

  const button =
    "rounded-lg bg-fc-blue-mid px-3 py-2 text-sm font-bold text-white hover:bg-fc-blue-dark disabled:opacity-50"
  const smallButton =
    "rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="App lock diagnostics" />
      <main {...mainContentTargetProps} className="flex-1 bg-fc-blue fc-scroll px-4 py-6">
        <div className="mx-auto flex max-w-xl flex-col gap-5">
          <p className="text-sm text-white/80">
            For each run, note which screen appeared: the device prompt alone, a passkey picker, or a
            password-manager screen. Then copy the log. These tests use their own credentials and never
            touch your real App lock.
          </p>

          <section className="rounded-xl bg-white p-4">
            <h2 className="mb-2 font-bold text-gray-800">This device</h2>
            {deviceState == null ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-gray-500">Credential stored</dt>
                <dd>{deviceState.credentialStored}</dd>
                <dt className="text-gray-500">Version marker</dt>
                <dd>{deviceState.versionMarker}</dd>
                <dt className="text-gray-500">Opted out</dt>
                <dd>{deviceState.optedOut}</dd>
                <dt className="text-gray-500">Grace period</dt>
                <dd>{deviceState.gracePeriod}</dd>
                <dt className="text-gray-500">Photo/camera suppression</dt>
                <dd>{deviceState.suppressed}</dd>
              </dl>
            )}
          </section>

          <label className="flex items-center justify-between gap-3 rounded-xl bg-white p-4 text-sm">
            <span className="font-semibold text-gray-800">
              Android &ldquo;Google&rdquo; provider is currently
            </span>
            <select
              className="rounded-lg border border-gray-300 px-2 py-1"
              value={provider}
              onChange={(e) => changeProvider(e.target.value)}
            >
              <option value="unknown">not set</option>
              <option value="on">ON</option>
              <option value="off">OFF</option>
            </select>
          </label>

          <div className="flex flex-col gap-3">
            {APP_LOCK_PROBE_SETS.map((set) => (
              <div key={set.key} className="flex items-center justify-between gap-3 rounded-xl bg-white p-4">
                <div>
                  <div className="font-semibold text-gray-800">{set.label}</div>
                  <div className="text-xs text-gray-500">{set.description}</div>
                </div>
                <button type="button" className={`shrink-0 ${button}`} disabled={busy} onClick={() => runCreate(set)}>
                  Create
                </button>
              </div>
            ))}
          </div>

          {creds.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wide text-white/70">Created credentials</h2>
              {creds.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-xs"
                >
                  <span className="font-mono text-gray-700">
                    {c.set} · Google {c.googleProvider} · {shortId(c.id)}
                  </span>
                  <button type="button" className={smallButton} disabled={busy} onClick={() => runGet(c)}>
                    Test get()
                  </button>
                </div>
              ))}
              <button type="button" className={`self-start ${smallButton} bg-white`} disabled={busy} onClick={clearCreds}>
                Clear list
              </button>
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wide text-white/70">Run log</h2>
              <button type="button" className={`${smallButton} bg-white`} onClick={copyLog}>
                {copied ? "Copied" : "Copy log"}
              </button>
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-xs text-white/80">
              {log.join("\n")}
            </pre>
          </div>
        </div>
      </main>
      <AppFooter />
    </div>
  )
}
