// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { acquireDbKey, getDbKey, hasDbKey, probeKeyserverHealth } from "@/lib/encryption/db-key"

const KEY_ENV_VARS = [
  "FC_ENCRYPTION_MODE",
  "FC_DB_KEY",
  "DB_ENCRYPTION_KEY",
  "DB_WRAPPED_KEY",
  "DB_KEY_SERVER_URL",
  "DB_KS_TOKEN",
  "DB_KS_CUSTOMER_ID",
  "HOST_ID",
  "INSTANCE_SUBDOMAIN",
] as const

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response
}

describe("db-key", () => {
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    for (const k of KEY_ENV_VARS) delete process.env[k]
    // Ensure the module-global key store starts clear for each test.
    await acquireDbKey()
  })

  afterEach(async () => {
    Object.keys(process.env).forEach(k => delete process.env[k])
    Object.assign(process.env, originalEnv)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await acquireDbKey()
  })

  describe("acquireDbKey / getDbKey / hasDbKey", () => {
    it("clears the key and reports unacquired when encryption mode is none", async () => {
      process.env.FC_ENCRYPTION_MODE = "none"
      await acquireDbKey()
      expect(hasDbKey()).toBe(false)
      expect(() => getDbKey()).toThrow(/not acquired/)
    })

    it("acquires the key from FC_DB_KEY in env mode", async () => {
      process.env.FC_ENCRYPTION_MODE = "env"
      process.env.FC_DB_KEY = "super-secret"
      await acquireDbKey()
      expect(hasDbKey()).toBe(true)
      expect(getDbKey()).toBe("super-secret")
    })

    it("falls back to legacy DB_ENCRYPTION_KEY when FC_DB_KEY is unset", async () => {
      process.env.FC_ENCRYPTION_MODE = "env"
      process.env.DB_ENCRYPTION_KEY = "legacy-secret"
      await acquireDbKey()
      expect(getDbKey()).toBe("legacy-secret")
    })

    it("rejects env mode when neither key variable is set", async () => {
      process.env.FC_ENCRYPTION_MODE = "env"
      await expect(acquireDbKey()).rejects.toThrow(/FC_DB_KEY/)
      expect(hasDbKey()).toBe(false)
    })

    it("rejects keyserver mode when DB_WRAPPED_KEY is unset", async () => {
      process.env.FC_ENCRYPTION_MODE = "keyserver"
      await expect(acquireDbKey()).rejects.toThrow(/DB_WRAPPED_KEY/)
    })

    it("acquires the key from the keyserver in keyserver mode", async () => {
      process.env.FC_ENCRYPTION_MODE = "keyserver"
      process.env.DB_WRAPPED_KEY = "wrapped-value"
      process.env.DB_KEY_SERVER_URL = "https://keys.example.com"
      process.env.DB_KS_TOKEN = "token"
      process.env.DB_KS_CUSTOMER_ID = "cust-1"
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse(200, { passphrase: "unwrapped-secret" })),
      )

      await acquireDbKey()

      expect(hasDbKey()).toBe(true)
      expect(getDbKey()).toBe("unwrapped-secret")
    })
  })

  describe("probeKeyserverHealth", () => {
    it("reports not-ok when DB_KEY_SERVER_URL is unset", async () => {
      const result = await probeKeyserverHealth()
      expect(result).toEqual({ ok: false, error: "DB_KEY_SERVER_URL not set" })
    })

    it("reports ok when the health endpoint responds 200", async () => {
      process.env.DB_KEY_SERVER_URL = "https://keys.example.com"
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {})))

      const result = await probeKeyserverHealth()

      expect(result).toEqual({ ok: true })
    })

    it("reports the HTTP status when the health endpoint responds with an error", async () => {
      process.env.DB_KEY_SERVER_URL = "https://keys.example.com"
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(503, {})))

      const result = await probeKeyserverHealth()

      expect(result).toEqual({ ok: false, error: "HTTP 503" })
    })

    it("reports the error message when the fetch itself throws", async () => {
      process.env.DB_KEY_SERVER_URL = "https://keys.example.com"
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")))

      const result = await probeKeyserverHealth()

      expect(result).toEqual({ ok: false, error: "network down" })
    })
  })
})
