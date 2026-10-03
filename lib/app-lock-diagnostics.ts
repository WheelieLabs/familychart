// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Probe option sets for the Diagnostics → App lock tool (ADR-0016), ported from
 * the on-device investigation. The tool uses its own relying-party display name and random
 * user handles so it never touches the real App lock credential.
 */

export type AppLockProbeKey = "A" | "B" | "C" | "D"

export type AppLockProbeSet = {
  key: AppLockProbeKey
  label: string
  description: string
  create: (
    challenge: BufferSource,
    host: string,
    userId: BufferSource,
    name: string,
  ) => PublicKeyCredentialCreationOptions
  get: (
    challenge: BufferSource,
    host: string,
    credId: BufferSource,
  ) => PublicKeyCredentialRequestOptions
}

const PROBE_TIMEOUT_MS = 60_000
const PROBE_RP_NAME = "FamilyChart diagnostics"
const ALGS: PublicKeyCredentialParameters[] = [
  { type: "public-key", alg: -7 },
  { type: "public-key", alg: -257 },
]
const UVM_EXTENSION = { uvm: true } as AuthenticationExtensionsClientInputs

const createA: AppLockProbeSet["create"] = (challenge, host, id, name) => ({
  challenge,
  rp: { name: PROBE_RP_NAME, id: host },
  user: { id, name, displayName: name },
  pubKeyCredParams: ALGS,
  authenticatorSelection: {
    authenticatorAttachment: "platform",
    residentKey: "discouraged",
    requireResidentKey: false,
    userVerification: "required",
  },
  attestation: "direct",
  extensions: { credProps: true },
  timeout: PROBE_TIMEOUT_MS,
})

const getA: AppLockProbeSet["get"] = (challenge, host, credId) => ({
  challenge,
  rpId: host,
  allowCredentials: [{ type: "public-key", id: credId, transports: ["internal"] }],
  userVerification: "required",
  extensions: UVM_EXTENSION,
  timeout: PROBE_TIMEOUT_MS,
})

export const APP_LOCK_PROBE_SETS: AppLockProbeSet[] = [
  {
    key: "A",
    label: "A: residentKey discouraged",
    description: "Device-bound path App lock uses (ADR-0016).",
    create: createA,
    get: getA,
  },
  {
    key: "B",
    label: "B: no authenticatorSelection",
    description: "Spec-default create; get without transports.",
    create: (challenge, host, id, name) => ({
      challenge,
      rp: { name: PROBE_RP_NAME, id: host },
      user: { id, name, displayName: name },
      pubKeyCredParams: ALGS,
      attestation: "direct",
      extensions: { credProps: true },
      timeout: PROBE_TIMEOUT_MS,
    }),
    get: (challenge, host, credId) => ({
      challenge,
      rpId: host,
      allowCredentials: [{ type: "public-key", id: credId }],
      userVerification: "required",
      extensions: UVM_EXTENSION,
      timeout: PROBE_TIMEOUT_MS,
    }),
  },
  {
    key: "C",
    label: "C: residentKey preferred",
    description: "The passkey-style options App lock used in 1.0.2–1.0.5.",
    create: (challenge, host, id, name) => ({
      challenge,
      rp: { name: PROBE_RP_NAME, id: host },
      user: { id, name, displayName: name },
      pubKeyCredParams: ALGS,
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
      attestation: "direct",
      extensions: { credProps: true },
      timeout: PROBE_TIMEOUT_MS,
    }),
    get: (challenge, host, credId) => ({
      challenge,
      rpId: host,
      allowCredentials: [{ type: "public-key", id: credId }],
      userVerification: "required",
      extensions: UVM_EXTENSION,
      timeout: PROBE_TIMEOUT_MS,
    }),
  },
  {
    key: "D",
    label: "D: A + client-device hint",
    description: 'Same as A, with hints: ["client-device"] on create and get.',
    create: (challenge, host, id, name) =>
      ({
        ...createA(challenge, host, id, name),
        hints: ["client-device"],
      }) as PublicKeyCredentialCreationOptions,
    get: (challenge, host, credId) =>
      ({
        ...getA(challenge, host, credId),
        hints: ["client-device"],
      }) as PublicKeyCredentialRequestOptions,
  },
]

/** Authenticator data: rpIdHash(32) | flags(1) | signCount(4) | [AAGUID(16) when AT is set]. */
export function describeAuthenticatorData(authData: ArrayBuffer): string {
  const b = new Uint8Array(authData)
  if (b.length < 37) return "authData too short"
  const f = b[32]
  const parts = [
    `UP=${+!!(f & 0x01)}`,
    `UV=${+!!(f & 0x04)}`,
    `BE=${+!!(f & 0x08)}`,
    `BS=${+!!(f & 0x10)}`,
  ]
  if (f & 0x40 && b.length >= 53) {
    const hex = Array.from(b.slice(37, 53), (x) => x.toString(16).padStart(2, "0")).join("")
    parts.push(
      `AAGUID=${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    )
  }
  return parts.join(" ")
}

/** Attestation objects put "fmt" first in CTAP2 canonical order: a3 63 'fmt' 6x <text>. */
export function readAttestationFormat(attestationObject: ArrayBuffer): string {
  const b = new Uint8Array(attestationObject)
  if (b.length < 6 || b[1] !== 0x63 || b[2] !== 0x66 || b[3] !== 0x6d || b[4] !== 0x74) {
    return "unparsed"
  }
  const head = b[5]
  if (head < 0x60 || head > 0x77) return "unparsed"
  return new TextDecoder().decode(b.slice(6, 6 + (head - 0x60)))
}

const UVM_METHODS: Record<number, string> = {
  0x1: "presence",
  0x2: "fingerprint",
  0x4: "passcode",
  0x10: "faceprint",
  0x80: "pattern",
  0x400: "passcode (external)",
  0x800: "pattern (external)",
}

/** Names the user-verification methods from a client-extension `uvm` result. */
export function describeUserVerificationMethods(
  extensionResults: { uvm?: unknown } | undefined,
): string {
  const uvm = extensionResults?.uvm
  if (!Array.isArray(uvm) || uvm.length === 0) return "none"
  return uvm
    .map((entry) => {
      if (!Array.isArray(entry) || typeof entry[0] !== "number") return "?"
      const method = entry[0]
      const names = Object.entries(UVM_METHODS)
        .filter(([bit]) => (method & Number(bit)) !== 0)
        .map(([, name]) => name)
      return names.length ? names.join("+") : `0x${method.toString(16)}`
    })
    .join(",")
}
