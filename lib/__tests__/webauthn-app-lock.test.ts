// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest"
import {
  CURRENT_BIOMETRIC_CREDENTIAL_VERSION,
  FAMILYCHART_BIOMETRIC_CREDENTIAL_ID_KEY,
  base64urlToUint8Array,
  biometricCredentialStorageKey,
  bufferToBase64url,
  buildCreateOptions,
  buildGetOptions,
  buildWebAuthnFailureReport,
  clearBiometricCredentialId,
  clearLegacyBiometricCredentialId,
  createLiveWebAuthnAdapter,
  describeWebAuthnError,
  readBiometricCredentialId,
  withWebAuthnTimeout,
  writeBiometricCredentialId,
} from "@/lib/webauthn-app-lock"

describe("bufferToBase64url / base64urlToUint8Array round trip", () => {
  it("round-trips arbitrary byte content through a Uint8Array", () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255])
    const encoded = bufferToBase64url(bytes)
    const decoded = base64urlToUint8Array(encoded)
    expect(decoded).toEqual(bytes)
  })

  it("round-trips a plain ArrayBuffer", () => {
    const buf = new Uint8Array([10, 20, 30]).buffer
    const encoded = bufferToBase64url(buf)
    expect(base64urlToUint8Array(encoded)).toEqual(new Uint8Array([10, 20, 30]))
  })

  it("round-trips a view over a larger buffer, respecting byteOffset/byteLength", () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9]).buffer
    const view = new Uint8Array(backing, 2, 3)
    const encoded = bufferToBase64url(view)
    expect(base64urlToUint8Array(encoded)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it("produces URL-safe output with no padding, +, or / characters", () => {
    // Byte lengths that force base64 padding (1 and 2 mod 3) to exercise the '=' stripping.
    for (const bytes of [new Uint8Array([255]), new Uint8Array([255, 254])]) {
      const encoded = bufferToBase64url(bytes)
      expect(encoded).not.toMatch(/[+/=]/)
    }
  })
})

describe("base64urlToUint8Array", () => {
  it("returns null for an empty or whitespace-only string", () => {
    expect(base64urlToUint8Array("")).toBeNull()
    expect(base64urlToUint8Array("   ")).toBeNull()
  })

  it("returns null for invalid base64url content", () => {
    expect(base64urlToUint8Array("not!!valid!!base64")).toBeNull()
  })

  it("decodes strings requiring each padding length (0, 2, 3 '=' chars added)", () => {
    // "Zg" (1 byte "f"), "Zm8" (2 bytes "fo"), "Zm9v" (3 bytes "foo", no padding needed)
    expect(base64urlToUint8Array("Zg")).toEqual(new TextEncoder().encode("f"))
    expect(base64urlToUint8Array("Zm8")).toEqual(new TextEncoder().encode("fo"))
    expect(base64urlToUint8Array("Zm9v")).toEqual(new TextEncoder().encode("foo"))
  })

  it("accepts '-' and '_' in place of '+' and '/'", () => {
    const bytes = new Uint8Array([251, 255, 191]) // encodes to base64 with '+' and '/' present
    const std = Buffer.from(bytes).toString("base64")
    expect(std).toMatch(/[+/]/)
    const urlSafe = std.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    expect(base64urlToUint8Array(urlSafe)).toEqual(bytes)
  })
})

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key)
    },
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
  }
}

describe("per-account biometric credential storage", () => {
  it("does not unlock with another account's stored credential", () => {
    const storage = memoryStorage()
    writeBiometricCredentialId(storage, "alice", "alice-cred")

    expect(readBiometricCredentialId(storage, "bob")).toBeNull()
    expect(readBiometricCredentialId(storage, "alice")).toBe("alice-cred")
  })

  it("does not unlock from the legacy device-wide key", () => {
    const storage = memoryStorage({
      [FAMILYCHART_BIOMETRIC_CREDENTIAL_ID_KEY]: "shared-cred",
    })

    expect(readBiometricCredentialId(storage, "alice")).toBeNull()
    expect(readBiometricCredentialId(storage, "bob")).toBeNull()
  })

  it("leaves another account's credential in place when writing", () => {
    const storage = memoryStorage()
    writeBiometricCredentialId(storage, "alice", "alice-cred")
    writeBiometricCredentialId(storage, "bob", "bob-cred")

    expect(readBiometricCredentialId(storage, "alice")).toBe("alice-cred")
    expect(readBiometricCredentialId(storage, "bob")).toBe("bob-cred")
  })

  it("clears only the given account's credential", () => {
    const storage = memoryStorage()
    writeBiometricCredentialId(storage, "alice", "alice-cred")
    writeBiometricCredentialId(storage, "bob", "bob-cred")

    clearBiometricCredentialId(storage, "alice")

    expect(readBiometricCredentialId(storage, "alice")).toBeNull()
    expect(readBiometricCredentialId(storage, "bob")).toBe("bob-cred")
  })

  it("does nothing when clearing a blank user id", () => {
    const storage = memoryStorage()
    writeBiometricCredentialId(storage, "alice", "alice-cred")

    clearBiometricCredentialId(storage, "   ")

    expect(readBiometricCredentialId(storage, "alice")).toBe("alice-cred")
  })

  it("clears the legacy device-wide key without removing per-account credentials", () => {
    const storage = memoryStorage()
    writeBiometricCredentialId(storage, "alice", "alice-cred")
    storage.setItem(FAMILYCHART_BIOMETRIC_CREDENTIAL_ID_KEY, "shared-cred")

    clearLegacyBiometricCredentialId(storage)

    expect(storage.getItem(FAMILYCHART_BIOMETRIC_CREDENTIAL_ID_KEY)).toBeNull()
    expect(readBiometricCredentialId(storage, "alice")).toBe("alice-cred")
  })

  it("stores the current version marker alongside the credential id", () => {
    const storage = memoryStorage()
    writeBiometricCredentialId(storage, "alice", "alice-cred")

    const raw = storage.getItem(biometricCredentialStorageKey("alice"))
    expect(JSON.parse(raw ?? "")).toEqual({
      v: CURRENT_BIOMETRIC_CREDENTIAL_VERSION,
      rawId: "alice-cred",
    })
  })

  it("treats a bare pre-version-marker string as not set up (ADR-0016 migration)", () => {
    const storage = memoryStorage({
      [biometricCredentialStorageKey("alice")]: "pre-adr-0016-raw-cred",
    })
    expect(readBiometricCredentialId(storage, "alice")).toBeNull()
  })

  it("treats a record under an older version marker as not set up", () => {
    const storage = memoryStorage({
      [biometricCredentialStorageKey("alice")]: JSON.stringify({ v: 1, rawId: "alice-cred" }),
    })
    expect(readBiometricCredentialId(storage, "alice")).toBeNull()
  })
})

describe("buildCreateOptions", () => {
  it("uses a 32-byte challenge, the given hostname, and required platform UV", () => {
    const opts = buildCreateOptions("user-1", "app.example.test")
    expect(opts.challenge).toBeInstanceOf(Uint8Array)
    expect((opts.challenge as Uint8Array).byteLength).toBe(32)
    expect(opts.rp).toEqual({ name: "FamilyChart", id: "app.example.test" })
    expect(opts.timeout).toBe(60_000)
    expect(opts.authenticatorSelection).toEqual({
      authenticatorAttachment: "platform",
      userVerification: "required",
      residentKey: "discouraged",
    })
    expect(opts.pubKeyCredParams).toEqual([
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 },
    ])
    expect(opts.user.name).toBe("user-1")
    expect(opts.user.displayName).toBe("FamilyChart")
  })

  it("truncates userHandle to exactly 64 bytes when the user id is longer", () => {
    const longId = "a".repeat(80)
    const opts = buildCreateOptions(longId, "localhost")
    expect(opts.user.id).toBeInstanceOf(Uint8Array)
    expect((opts.user.id as Uint8Array).byteLength).toBe(64)
    expect(opts.user.id).toEqual(new TextEncoder().encode("a".repeat(64)))
  })

  it("does not truncate a userHandle of 64 bytes or fewer", () => {
    const opts = buildCreateOptions("short-id", "localhost")
    expect(opts.user.id).toEqual(new TextEncoder().encode("short-id"))

    const exact = "b".repeat(64)
    const exactOpts = buildCreateOptions(exact, "localhost")
    expect((exactOpts.user.id as Uint8Array).byteLength).toBe(64)
    expect(exactOpts.user.id).toEqual(new TextEncoder().encode(exact))
  })

  it("uses the familychart-lock fallback handle for a blank user id", () => {
    const opts = buildCreateOptions("   ", "localhost")
    expect(opts.user.id).toEqual(new TextEncoder().encode("familychart-lock"))
  })
})

describe("buildGetOptions", () => {
  it("uses a 32-byte challenge, the given hostname, and the stored credential id", () => {
    const credentialId = new Uint8Array([1, 2, 3, 4])
    const opts = buildGetOptions(credentialId, "lock.example.test")
    expect(opts.challenge).toBeInstanceOf(Uint8Array)
    expect((opts.challenge as Uint8Array).byteLength).toBe(32)
    expect(opts.rpId).toBe("lock.example.test")
    expect(opts.timeout).toBe(60_000)
    expect(opts.userVerification).toBe("required")
    expect(opts.allowCredentials).toEqual([
      { type: "public-key", id: new Uint8Array([1, 2, 3, 4]) },
    ])
  })
})

describe("live WebAuthnAdapter narrowing", () => {
  it("create returns null when the credential is not a PublicKeyCredential", async () => {
    class FakePublicKeyCredential {
      rawId = new ArrayBuffer(8)
    }
    const previous = (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential
    ;(globalThis as { PublicKeyCredential: unknown }).PublicKeyCredential = FakePublicKeyCredential
    try {
      const adapter = createLiveWebAuthnAdapter({
        create: async () => ({ rawId: new ArrayBuffer(8) }),
        get: async () => null,
      })
      await expect(
        adapter.create(buildCreateOptions("user-1", "localhost")),
      ).resolves.toBeNull()
    } finally {
      if (previous === undefined) {
        delete (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential
      } else {
        ;(globalThis as { PublicKeyCredential: unknown }).PublicKeyCredential = previous
      }
    }
  })

  it("get returns null when the credential has no response", async () => {
    class FakePublicKeyCredential {
      rawId = new ArrayBuffer(8)
    }
    const previous = (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential
    ;(globalThis as { PublicKeyCredential: unknown }).PublicKeyCredential = FakePublicKeyCredential
    try {
      const cred = new FakePublicKeyCredential()
      const adapter = createLiveWebAuthnAdapter({
        create: async () => null,
        get: async () => cred,
      })
      await expect(
        adapter.get(buildGetOptions(new Uint8Array([1]), "localhost")),
      ).resolves.toBeNull()
    } finally {
      if (previous === undefined) {
        delete (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential
      } else {
        ;(globalThis as { PublicKeyCredential: unknown }).PublicKeyCredential = previous
      }
    }
  })

  it("forwards the given AbortSignal through to credentials.create", async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const adapter = createLiveWebAuthnAdapter({
      create: async (opts) => {
        receivedSignal = opts?.signal ?? undefined
        return null
      },
      get: async () => null,
    })
    await adapter.create(buildCreateOptions("user-1", "localhost"), controller.signal)
    expect(receivedSignal).toBe(controller.signal)
  })

  it("forwards the given AbortSignal through to credentials.get", async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const adapter = createLiveWebAuthnAdapter({
      create: async () => null,
      get: async (opts) => {
        receivedSignal = opts?.signal ?? undefined
        return null
      },
    })
    await adapter.get(buildGetOptions(new Uint8Array([1]), "localhost"), controller.signal)
    expect(receivedSignal).toBe(controller.signal)
  })
})

describe("describeWebAuthnError", () => {
  it("appends the DOMException name so a failure carries real diagnostic signal", () => {
    const e = new DOMException("The operation either timed out or was not allowed.", "NotAllowedError")
    expect(describeWebAuthnError(e, "fallback")).toBe(
      "The operation either timed out or was not allowed. (NotAllowedError)",
    )
  })

  it("falls back to the given message when a DOMException has no message", () => {
    const e = new DOMException("", "NotAllowedError")
    expect(describeWebAuthnError(e, "fallback")).toBe("fallback (NotAllowedError)")
  })

  it("uses a plain Error's message unchanged", () => {
    expect(describeWebAuthnError(new Error("boom"), "fallback")).toBe("boom")
  })

  it("uses the fallback for a non-Error value", () => {
    expect(describeWebAuthnError("not an error", "fallback")).toBe("fallback")
  })
})

describe("buildWebAuthnFailureReport", () => {
  it("captures the DOMException name, phase, elapsed time, and user agent", () => {
    const e = new DOMException("nope", "NotAllowedError")
    expect(buildWebAuthnFailureReport("get", e, 1234, "ua-string")).toEqual({
      phase: "get",
      errorName: "NotAllowedError",
      elapsedMs: 1234,
      userAgent: "ua-string",
    })
  })

  it("captures a plain Error's name", () => {
    expect(buildWebAuthnFailureReport("create", new Error("boom"), 5, "ua")).toEqual({
      phase: "create",
      errorName: "Error",
      elapsedMs: 5,
      userAgent: "ua",
    })
  })

  it("falls back to 'Unknown' for a non-Error value, never including it verbatim", () => {
    expect(buildWebAuthnFailureReport("verify", "some string", 0, "ua")).toEqual({
      phase: "verify",
      errorName: "Unknown",
      elapsedMs: 0,
      userAgent: "ua",
    })
  })
})

describe("withWebAuthnTimeout", () => {
  it("resolves with the operation's result when it settles before the timeout", async () => {
    const result = await withWebAuthnTimeout(async () => "ok", 1000, "timed out")
    expect(result).toBe("ok")
  })

  it("propagates a non-abort error from the operation unchanged", async () => {
    await expect(
      withWebAuthnTimeout(async () => {
        throw new Error("boom")
      }, 1000, "timed out"),
    ).rejects.toThrow("boom")
  })

  it("aborts the signal and rejects with the timeout message when the operation honors abort", async () => {
    vi.useFakeTimers()
    try {
      let receivedSignal: AbortSignal | undefined
      const pending = withWebAuthnTimeout<never>((signal) => {
        receivedSignal = signal
        // Simulates a well-behaved navigator.credentials call: it hangs
        // until the signal aborts, then rejects with an AbortError.
        return new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
        })
      }, 1000, "timed out")

      const assertion = expect(pending).rejects.toThrow("timed out")
      await vi.advanceTimersByTimeAsync(1000)
      await assertion

      expect(receivedSignal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects immediately with the cancel message when the cancel signal fires, well before the timeout", async () => {
    vi.useFakeTimers()
    try {
      const cancelController = new AbortController()
      let receivedSignal: AbortSignal | undefined
      const pending = withWebAuthnTimeout<never>(
        (signal) => {
          receivedSignal = signal
          return new Promise(() => {
            /* never settles on its own */
          })
        },
        60_000,
        "timed out",
        { cancelSignal: cancelController.signal, cancelMessage: "Cancelled." },
      )

      const assertion = expect(pending).rejects.toThrow("Cancelled.")
      cancelController.abort()
      await assertion

      expect(receivedSignal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects immediately if the cancel signal is already aborted before the call starts", async () => {
    const cancelController = new AbortController()
    cancelController.abort()
    await expect(
      withWebAuthnTimeout<never>(
        () => new Promise(() => {}),
        60_000,
        "timed out",
        { cancelSignal: cancelController.signal, cancelMessage: "Cancelled." },
      ),
    ).rejects.toThrow("Cancelled.")
  })

  it("still rejects with the timeout message when the operation never settles, even after abort", async () => {
    // Some platforms (observed: Android Chrome + Credential Manager) don't
    // honor AbortSignal for an in-flight WebAuthn ceremony — the promise
    // just never settles. Recovery must not depend on the operation ever
    // reacting to abort(); it has to come from an independent timer race.
    vi.useFakeTimers()
    try {
      let receivedSignal: AbortSignal | undefined
      const pending = withWebAuthnTimeout<never>((signal) => {
        receivedSignal = signal
        return new Promise(() => {
          /* never settles, even once aborted */
        })
      }, 1000, "timed out")

      const assertion = expect(pending).rejects.toThrow("timed out")
      await vi.advanceTimersByTimeAsync(1000)
      await assertion

      expect(receivedSignal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
