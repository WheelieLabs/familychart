// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useSession } from "next-auth/react"
import { useCallback, useEffect, useState } from "react"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import Button from "@/components/ui/Button"
import { Select } from "@/components/ui/controls"
import FormField from "@/components/ui/FormField"
import ListCard, { CardList } from "@/components/ui/ListCard"
import PageContainer from "@/components/ui/PageContainer"
import Panel from "@/components/ui/Panel"
import { formatTime } from "@/lib/date-format"
import { diagnosticsTrail } from "@/lib/ui/breadcrumbs"
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
    setLog((prev) => [...prev, `[${formatTime(new Date(), { seconds: true })}] ${line}`])
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

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="App Lock" />
      <PageContainer trail={diagnosticsTrail({ label: "App Lock" })}>
        <p className="fc-export-note">
          For each run, note which screen appeared: the device prompt alone, a passkey picker, or a
          password-manager screen. Then copy the log. These tests use their own credentials and never
          touch your real App lock.
        </p>

        <Panel as="section" aria-labelledby="diag-device">
          <h2 id="diag-device" className="fc-section-title">This device</h2>
          {deviceState == null ? (
            <p className="fc-section-copy">Loading…</p>
          ) : (
            <dl className="fc-dl">
              <dt>Credential stored</dt>
              <dd>{deviceState.credentialStored}</dd>
              <dt>Version marker</dt>
              <dd>{deviceState.versionMarker}</dd>
              <dt>Opted out</dt>
              <dd>{deviceState.optedOut}</dd>
              <dt>Grace period</dt>
              <dd>{deviceState.gracePeriod}</dd>
              <dt>Photo/camera suppression</dt>
              <dd>{deviceState.suppressed}</dd>
            </dl>
          )}
        </Panel>

        <Panel>
          <FormField label="Android “Google” provider is currently">
            <Select value={provider} onChange={(e) => changeProvider(e.target.value)}>
              <option value="unknown">not set</option>
              <option value="on">ON</option>
              <option value="off">OFF</option>
            </Select>
          </FormField>
        </Panel>

        <CardList>
          {APP_LOCK_PROBE_SETS.map((set) => (
            <ListCard
              key={set.key}
              title={set.label}
              meta={[set.description]}
              trailing={
                <Button size="compact" pending={busy} pendingLabel="Working…" onClick={() => runCreate(set)} aria-label={`Create ${set.label}`}>
                  Create
                </Button>
              }
            />
          ))}
        </CardList>

        {creds.length > 0 && (
          <section aria-labelledby="diag-created" className="fc-form">
            <h2 id="diag-created" className="fc-block-heading">Created credentials</h2>
            <CardList>
              {creds.map((c) => (
                <ListCard
                  key={c.id}
                  title={c.set}
                  meta={[`Google ${c.googleProvider}`, shortId(c.id)]}
                  trailing={
                    <Button variant="secondary" size="compact" pending={busy} pendingLabel="Working…" onClick={() => runGet(c)} aria-label={`Test get() for ${c.set}`}>
                      Test get()
                    </Button>
                  }
                />
              ))}
            </CardList>
            <div className="fc-form-actions">
              <Button variant="secondary" size="compact" pending={busy} pendingLabel="Working…" onClick={clearCreds}>
                Clear list
              </Button>
            </div>
          </section>
        )}

        <section aria-labelledby="diag-log" className="fc-form">
          <div className="fc-log-head">
            <h2 id="diag-log" className="fc-block-heading">Run log</h2>
            <Button variant="secondary" size="compact" onClick={copyLog}>
              {copied ? "Copied" : "Copy log"}
            </Button>
          </div>
          <pre className="fc-log" tabIndex={0} aria-label="Run log output">{log.join("\n")}</pre>
        </section>
      </PageContainer>
      <AppFooter />
    </div>
  )
}
