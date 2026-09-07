// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  __resetAppOnlyGraphTokenCacheForTests,
  __setAppOnlyGraphTokenAdapterForTests,
  getAppOnlyGraphToken,
  loadEntraGraphConfig,
  type EntraGraphConfig,
} from "@/lib/entra-graph-token"

const CFG: EntraGraphConfig = {
  tenantId: "tenant-id",
  clientId: "client-id",
  clientSecret: "client-secret",
}

describe("loadEntraGraphConfig — env-sourced only", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.AUTH_MICROSOFT_ENTRA_ID_ID
    delete process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET
    delete process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID
  })

  afterEach(() => {
    Object.keys(process.env).forEach(k => delete process.env[k])
    Object.assign(process.env, originalEnv)
  })

  it("null when env credentials are not fully set", () => {
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "client-id"
    expect(loadEntraGraphConfig()).toBeNull()
  })

  it("returns config when all three env vars are set", () => {
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "client-id"
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = "client-secret"
    process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID = "tenant-id"
    expect(loadEntraGraphConfig()).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
      tenantId: "tenant-id",
    })
  })
})

describe("getAppOnlyGraphToken", () => {
  beforeEach(() => {
    __resetAppOnlyGraphTokenCacheForTests()
    __setAppOnlyGraphTokenAdapterForTests(null)
  })

  afterEach(() => {
    __setAppOnlyGraphTokenAdapterForTests(null)
    __resetAppOnlyGraphTokenCacheForTests()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("fetches a client-credentials token and reuses the cache within the skew window", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok-1", expires_in: 3600 }),
      })
    vi.stubGlobal("fetch", fetchMock)

    await expect(getAppOnlyGraphToken(CFG)).resolves.toBe("tok-1")
    await expect(getAppOnlyGraphToken(CFG)).resolves.toBe("tok-1")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token",
    )
  })

  it("throws when the token endpoint rejects the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "unauthorized",
      }),
    )

    await expect(getAppOnlyGraphToken(CFG)).rejects.toThrow(/Graph token request failed \(401\)/)
  })

  it("uses an injected adapter instead of the live token fetch", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    __setAppOnlyGraphTokenAdapterForTests({
      getToken: async () => "fake-token",
    })

    await expect(getAppOnlyGraphToken(CFG)).resolves.toBe("fake-token")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
