import { describe, it, expect } from "vitest"
import {
  APP_LOCK_PROBE_SETS,
  describeAuthenticatorData,
  describeUserVerificationMethods,
  readAttestationFormat,
} from "@/lib/app-lock-diagnostics"

const challenge = new Uint8Array(32)
const userId = new Uint8Array(16)
const credId = new Uint8Array([1, 2, 3])

describe("APP_LOCK_PROBE_SETS", () => {
  it("defines sets A to D", () => {
    expect(APP_LOCK_PROBE_SETS.map((s) => s.key)).toEqual(["A", "B", "C", "D"])
  })

  it("gives every set a 60s timeout on create and get", () => {
    for (const set of APP_LOCK_PROBE_SETS) {
      expect(set.create(challenge, "h", userId, "n").timeout).toBe(60_000)
      expect(set.get(challenge, "h", credId).timeout).toBe(60_000)
    }
  })

  it("uses its own relying-party display name, never FamilyChart's real one", () => {
    for (const set of APP_LOCK_PROBE_SETS) {
      expect(set.create(challenge, "h", userId, "n").rp.name).not.toBe("FamilyChart")
    }
  })

  it("A is the device-bound option set", () => {
    const a = APP_LOCK_PROBE_SETS[0].create(challenge, "h", userId, "n")
    expect(a.authenticatorSelection?.residentKey).toBe("discouraged")
    expect(a.authenticatorSelection?.authenticatorAttachment).toBe("platform")
  })

  it("C reproduces the old passkey-style options", () => {
    const c = APP_LOCK_PROBE_SETS[2].create(challenge, "h", userId, "n")
    expect(c.authenticatorSelection?.residentKey).toBe("preferred")
  })

  it("B omits authenticatorSelection", () => {
    const b = APP_LOCK_PROBE_SETS[1].create(challenge, "h", userId, "n")
    expect(b.authenticatorSelection).toBeUndefined()
  })

  it("D adds the client-device hint to A", () => {
    const d = APP_LOCK_PROBE_SETS[3].create(challenge, "h", userId, "n") as unknown as { hints?: string[] }
    expect(d.hints).toEqual(["client-device"])
  })
})

describe("describeAuthenticatorData", () => {
  function authData(flags: number, aaguid?: number[]) {
    const bytes = new Uint8Array(aaguid ? 55 : 37)
    bytes[32] = flags
    if (aaguid) bytes.set(aaguid, 37)
    return bytes.buffer
  }

  it("reports the flags", () => {
    expect(describeAuthenticatorData(authData(0x05))).toBe("UP=1 UV=1 BE=0 BS=0")
  })

  it("reports backup-eligible and backed-up", () => {
    expect(describeAuthenticatorData(authData(0x1d))).toContain("BE=1 BS=1")
  })

  it("appends the AAGUID when attested credential data is present", () => {
    const aaguid = [0xb9, 0x3f, 0xd9, 0x61, 0xf2, 0xe6, 0x46, 0x2f, 0xb1, 0x22, 0x82, 0x00, 0x22, 0x47, 0xde, 0x78]
    expect(describeAuthenticatorData(authData(0x45, aaguid))).toContain(
      "AAGUID=b93fd961-f2e6-462f-b122-82002247de78",
    )
  })

  it("rejects short data", () => {
    expect(describeAuthenticatorData(new ArrayBuffer(10))).toBe("authData too short")
  })
})

describe("readAttestationFormat", () => {
  it("reads fmt from a canonical CTAP2 attestation object", () => {
    const fmt = new TextEncoder().encode("android-key")
    const bytes = new Uint8Array([0xa3, 0x63, 0x66, 0x6d, 0x74, 0x60 + fmt.length, ...fmt])
    expect(readAttestationFormat(bytes.buffer)).toBe("android-key")
  })

  it("returns unparsed for anything else", () => {
    expect(readAttestationFormat(new Uint8Array([1, 2, 3]).buffer)).toBe("unparsed")
  })
})

describe("describeUserVerificationMethods", () => {
  it("names fingerprint", () => {
    expect(describeUserVerificationMethods({ uvm: [[0x2, 1, 1]] })).toBe("fingerprint")
  })

  it("combines bits and joins entries", () => {
    expect(describeUserVerificationMethods({ uvm: [[0x6], [0x80]] })).toBe("fingerprint+passcode,pattern")
  })

  it("returns none when absent", () => {
    expect(describeUserVerificationMethods({})).toBe("none")
    expect(describeUserVerificationMethods(undefined)).toBe("none")
  })
})
