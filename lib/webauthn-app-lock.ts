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
  create(options: PublicKeyCredentialCreationOptions): Promise<{ rawId: ArrayBuffer } | null>
  get(options: PublicKeyCredentialRequestOptions): Promise<{ ok: true } | null>
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
    async create(options) {
      const cred = await credentials.create({ publicKey: options })
      if (!isPublicKeyCredential(cred) || !cred.rawId) return null
      return { rawId: cred.rawId }
    },
    async get(options) {
      const cred = await credentials.get({ publicKey: options })
      if (isPublicKeyCredential(cred) && cred.response) return { ok: true }
      return null
    },
  }
}

/** Production adapter — reads `navigator.credentials` at call time. */
export const liveWebAuthnAdapter: WebAuthnAdapter = {
  create(options) {
    return createLiveWebAuthnAdapter(navigator.credentials).create(options)
  },
  get(options) {
    return createLiveWebAuthnAdapter(navigator.credentials).get(options)
  },
}

let adapter: WebAuthnAdapter = liveWebAuthnAdapter

export function getWebAuthnAdapter(): WebAuthnAdapter {
  return adapter
}

/** Test-only: replace the live WebAuthn adapter (pass `null` to restore). */
export function __setWebAuthnAdapterForTests(next: WebAuthnAdapter | null): void {
  adapter = next ?? liveWebAuthnAdapter
}
