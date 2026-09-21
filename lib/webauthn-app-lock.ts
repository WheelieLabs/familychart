// SPDX-License-Identifier: AGPL-3.0-only

/** Legacy device-wide localStorage key (pre per-account binding). Do not read for unlock. */
export const FAMILYCHART_BIOMETRIC_CREDENTIAL_ID_KEY =
  "familychart_biometric_credential_id"

export function biometricCredentialStorageKey(userId: string): string {
  return `${FAMILYCHART_BIOMETRIC_CREDENTIAL_ID_KEY}:${encodeURIComponent(userId)}`
}

export function readBiometricCredentialId(
  storage: Pick<Storage, "getItem">,
  userId: string,
): string | null {
  const id = userId.trim()
  if (!id) return null
  try {
    const raw = storage.getItem(biometricCredentialStorageKey(id))
    return raw != null && raw !== "" ? raw : null
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
    storage.setItem(biometricCredentialStorageKey(id), encoded)
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
      // Discoverable credentials are the well-supported path through
      // Android's Credential Manager passkey stack. A non-discoverable
      // ("discouraged", the spec default) credential has been observed to
      // create successfully but then fail get() instantly and permanently
      // on some Android/Chrome combinations, with no sensor prompt at all.
      residentKey: "preferred",
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
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout>

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new Error(timeoutMessage))
    }, ms)
  })

  const operation = run(controller.signal).catch((err: unknown) => {
    if (timedOut) throw new Error(timeoutMessage)
    throw err
  })

  try {
    return await Promise.race([operation, timeout])
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

/**
 * True when a get()/create() call failed because Android's Credential
 * Manager already has an earlier request wedged open system-wide — seen
 * when an in-flight ceremony never settles and our own timeout only
 * recovers the UI, not the OS-level request. Every retry after that first
 * hang fails instantly with this same error until the app process is fully
 * killed and relaunched; showing a plain "try again" for this case sends
 * the user into a loop that can never succeed.
 */
export function isWebAuthnAlreadyPendingError(e: unknown): boolean {
  return (
    e instanceof DOMException
    && e.name === "OperationError"
    && /already pending/i.test(e.message)
  )
}

let adapter: WebAuthnAdapter = liveWebAuthnAdapter

export function getWebAuthnAdapter(): WebAuthnAdapter {
  return adapter
}

/** Test-only: replace the live WebAuthn adapter (pass `null` to restore). */
export function __setWebAuthnAdapterForTests(next: WebAuthnAdapter | null): void {
  adapter = next ?? liveWebAuthnAdapter
}
