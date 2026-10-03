// SPDX-License-Identifier: AGPL-3.0-only

/** Legacy device-wide localStorage key (pre per-account binding). Do not read for unlock. */
export const FAMILYCHART_BIOMETRIC_CREDENTIAL_ID_KEY =
  "familychart_biometric_credential_id"

export function biometricCredentialStorageKey(userId: string): string {
  return `${FAMILYCHART_BIOMETRIC_CREDENTIAL_ID_KEY}:${encodeURIComponent(userId)}`
}

/**
 * Bumped when the credential options a stored record was created under
 * change in a way that invalidates it (ADR-0016: moving from the
 * discoverable "preferred" residentKey to the device-bound "discouraged"
 * one). A record missing this marker — including every pre-ADR-0016
 * passkey-style record, which predates the marker entirely — is treated as
 * "not set up", forcing a one-time re-setup per device. The underlying
 * passkey the old record pointed to is left on the authenticator; nothing
 * here deletes it.
 */
export const CURRENT_BIOMETRIC_CREDENTIAL_VERSION = 2

interface StoredBiometricCredentialRecord {
  v: number
  rawId: string
}

function parseStoredBiometricCredentialRecord(raw: string): StoredBiometricCredentialRecord | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed != null
      && typeof parsed === "object"
      && "v" in parsed
      && "rawId" in parsed
      && typeof (parsed as { v: unknown }).v === "number"
      && typeof (parsed as { rawId: unknown }).rawId === "string"
    ) {
      return parsed as StoredBiometricCredentialRecord
    }
    return null
  } catch {
    // A bare base64url string (every record written before the version
    // marker existed) isn't valid JSON — falls through to "not set up".
    return null
  }
}

/** Returns the stored credential's rawId only when it carries the current version marker. */
export function readBiometricCredentialId(
  storage: Pick<Storage, "getItem">,
  userId: string,
): string | null {
  const id = userId.trim()
  if (!id) return null
  try {
    const raw = storage.getItem(biometricCredentialStorageKey(id))
    if (raw == null || raw === "") return null
    const record = parseStoredBiometricCredentialRecord(raw)
    if (!record || record.v !== CURRENT_BIOMETRIC_CREDENTIAL_VERSION) return null
    return record.rawId
  } catch {
    return null
  }
}

export function writeBiometricCredentialId(
  storage: Pick<Storage, "setItem" | "removeItem">,
  userId: string,
  encoded: string,
): void {
  const id = userId.trim()
  if (!id) throw new Error("Cannot save biometric unlock without a signed-in account.")
  try {
    const record: StoredBiometricCredentialRecord = {
      v: CURRENT_BIOMETRIC_CREDENTIAL_VERSION,
      rawId: encoded,
    }
    storage.setItem(biometricCredentialStorageKey(id), JSON.stringify(record))
    clearLegacyBiometricCredentialId(storage)
  } catch {
    throw new Error("Cannot save biometric unlock on this device.")
  }
}

export function clearLegacyBiometricCredentialId(
  storage: Pick<Storage, "removeItem">,
): void {
  try {
    storage.removeItem(FAMILYCHART_BIOMETRIC_CREDENTIAL_ID_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Drops the stored credential for an account so the next unlock falls back
 * to setup mode. Needed when the platform authenticator can no longer
 * satisfy it — e.g. Android invalidates all platform passkeys when the
 * device's lock-screen credential changes or biometrics are re-enrolled,
 * and get() then rejects instantly without ever prompting, forever.
 */
export function clearBiometricCredentialId(
  storage: Pick<Storage, "removeItem">,
  userId: string,
): void {
  const id = userId.trim()
  if (!id) return
  try {
    storage.removeItem(biometricCredentialStorageKey(id))
  } catch {
    /* ignore */
  }
}

/** Uint8Array → base64url (no padding). */
export function bufferToBase64url(buf: BufferSource): string {
  const bytes =
    buf instanceof ArrayBuffer
      ? new Uint8Array(buf)
      : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  let bin = ""
  for (let i = 0; i < bytes.length; i++)
    bin += String.fromCharCode(bytes[i])

  let b64 = btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")

  while (b64.endsWith("=")) b64 = b64.slice(0, -1)
  return b64
}

/** base64url → Uint8Array, or null if invalid. */
export function base64urlToUint8Array(s: string): Uint8Array | null {
  if (!s.trim()) return null
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/")
  const pad = b64.length % 4
  if (pad === 2) b64 += "=="
  else if (pad === 3) b64 += "="

  try {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

function randomChallenge(): Uint8Array<ArrayBuffer> {
  const challenge = new Uint8Array(32)
  crypto.getRandomValues(challenge)
  return challenge
}

function userHandleFromUserId(userId: string): Uint8Array<ArrayBuffer> {
  const encodedHandle = new TextEncoder().encode(userId.trim() || "familychart-lock")
  return encodedHandle.byteLength <= 64 ? encodedHandle : encodedHandle.slice(0, 64)
}

export function buildCreateOptions(
  userId: string,
  hostname: string,
): PublicKeyCredentialCreationOptions {
  return {
    challenge: randomChallenge(),
    rp: {
      name: "FamilyChart",
      id: hostname,
    },
    user: {
      id: userHandleFromUserId(userId),
      name: userId,
      displayName: "FamilyChart",
    },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 },
    ],
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      userVerification: "required",
      // ADR-0016: a discoverable credential ("preferred"/"required") routes
      // through Chrome for Android's Credential Manager passkey picker on
      // every unlock, even when only one credential is registered. The
      // non-discoverable, device-bound path ("discouraged") stays on the
      // platform authenticator directly and gives fingerprint/face-only
      // unlock with no picker — confirmed by an on-device probe, see the ADR.
      residentKey: "discouraged",
    },
    timeout: 60_000,
  }
}

export function buildGetOptions(
  credentialId: Uint8Array,
  hostname: string,
): PublicKeyCredentialRequestOptions {
  return {
    challenge: randomChallenge(),
    allowCredentials: [
      {
        type: "public-key",
        id: new Uint8Array(credentialId) as Uint8Array<ArrayBuffer>,
      },
    ],
    userVerification: "required",
    rpId: hostname,
    timeout: 60_000,
  }
}

export interface WebAuthnAdapter {
  create(
    options: PublicKeyCredentialCreationOptions,
    signal?: AbortSignal,
  ): Promise<{ rawId: ArrayBuffer } | null>
  get(
    options: PublicKeyCredentialRequestOptions,
    signal?: AbortSignal,
  ): Promise<{ ok: true } | null>
}

export type WebAuthnCredentialsApi = {
  create(options?: CredentialCreationOptions): Promise<unknown>
  get(options?: CredentialRequestOptions): Promise<unknown>
}

function isPublicKeyCredential(cred: unknown): cred is PublicKeyCredential {
  return typeof PublicKeyCredential !== "undefined" && cred instanceof PublicKeyCredential
}

export function createLiveWebAuthnAdapter(
  credentials: WebAuthnCredentialsApi,
): WebAuthnAdapter {
  return {
    async create(options, signal) {
      const cred = await credentials.create({ publicKey: options, signal })
      if (!isPublicKeyCredential(cred) || !cred.rawId) return null
      return { rawId: cred.rawId }
    },
    async get(options, signal) {
      const cred = await credentials.get({ publicKey: options, signal })
      if (isPublicKeyCredential(cred) && cred.response) return { ok: true }
      return null
    },
  }
}

/** Production adapter — reads `navigator.credentials` at call time. */
export const liveWebAuthnAdapter: WebAuthnAdapter = {
  create(options, signal) {
    return createLiveWebAuthnAdapter(navigator.credentials).create(options, signal)
  },
  get(options, signal) {
    return createLiveWebAuthnAdapter(navigator.credentials).get(options, signal)
  },
}

/**
 * Runs a WebAuthn ceremony but recovers once `ms` elapses, whether or not
 * the browser cooperates. Needed because navigator.credentials.get()/
 * create() can hang indefinitely on some platforms (observed: Android
 * Chrome + Credential Manager, installed PWAs) when invoked without a
 * fresh, direct user gesture. `controller.abort()` is a best-effort signal
 * so a well-behaved browser tears down the pending ceremony (avoiding "a
 * request is already pending" on retry) — but some platforms don't honor
 * it for an in-flight WebAuthn call, leaving `run()`'s promise never
 * settling at all. Racing against an independent timer, instead of solely
 * awaiting `run()` and relying on the abort to make it reject, is what
 * guarantees recovery in that case.
 */
export async function withWebAuthnTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  timeoutMessage: string,
  options?: { cancelSignal?: AbortSignal; cancelMessage?: string },
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  let cancelled = false
  let timer: ReturnType<typeof setTimeout>

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new Error(timeoutMessage))
    }, ms)
  })

  // A visible Cancel button (ADR-0016: never trap the user staring at a spinner) aborts
  // immediately rather than waiting for the safety-net timer.
  const cancelSignal = options?.cancelSignal
  const cancel = cancelSignal
    ? new Promise<never>((_, reject) => {
        const onCancel = () => {
          cancelled = true
          controller.abort()
          reject(new Error(options?.cancelMessage ?? "Cancelled."))
        }
        if (cancelSignal.aborted) onCancel()
        else cancelSignal.addEventListener("abort", onCancel, { once: true })
      })
    : null

  const operation = run(controller.signal).catch((err: unknown) => {
    if (cancelled) throw new Error(options?.cancelMessage ?? "Cancelled.")
    if (timedOut) throw new Error(timeoutMessage)
    throw err
  })

  try {
    return await Promise.race(cancel ? [operation, timeout, cancel] : [operation, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

/**
 * Formats a WebAuthn failure for display, appending the DOMException name
 * (e.g. "NotAllowedError") when there is one. Prior investigations of
 * repeated ceremony failures had no evidence of *why* the browser rejected
 * the call beyond a generic caught Error — this keeps that detail visible
 * instead of discarding it, so the next report carries real diagnostic
 * signal instead of another guess.
 */
export function describeWebAuthnError(e: unknown, fallback: string): string {
  if (e instanceof DOMException) return `${e.message || fallback} (${e.name})`
  if (e instanceof Error) return e.message || fallback
  return fallback
}

export type WebAuthnCeremonyPhase = "create" | "get" | "verify"

export interface WebAuthnFailureReport {
  phase: WebAuthnCeremonyPhase
  errorName: string
  elapsedMs: number
  userAgent: string
}

/**
 * Shapes a ceremony failure for the server failure-log endpoint. Deliberately
 * excludes the credential id, challenge, or any authenticator data — only
 * enough to notice a recurrence and tell failures apart (ADR-0016).
 */
export function buildWebAuthnFailureReport(
  phase: WebAuthnCeremonyPhase,
  error: unknown,
  elapsedMs: number,
  userAgent: string,
): WebAuthnFailureReport {
  const errorName =
    error instanceof DOMException || error instanceof Error ? error.name : "Unknown"
  return { phase, errorName, elapsedMs, userAgent }
}

let adapter: WebAuthnAdapter = liveWebAuthnAdapter

export function getWebAuthnAdapter(): WebAuthnAdapter {
  return adapter
}

/** Test-only: replace the live WebAuthn adapter (pass `null` to restore). */
export function __setWebAuthnAdapterForTests(next: WebAuthnAdapter | null): void {
  adapter = next ?? liveWebAuthnAdapter
}
