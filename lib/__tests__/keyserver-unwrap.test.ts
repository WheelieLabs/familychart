// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { unwrapKeyFromKeyserver } from "@/lib/encryption/keyserver-unwrap"

const CONNECTION_ENV = {
  DB_KEY_SERVER_URL: "https://keys.example.com",
  DB_KS_TOKEN: "token",
  DB_KS_CUSTOMER_ID: "cust-1",
} as const

const noopSleep = async () => {}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response
}

describe("unwrapKeyFromKeyserver", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    for (const k of Object.keys(CONNECTION_ENV)) delete process.env[k]
    delete process.env.HOST_ID
    delete process.env.INSTANCE_SUBDOMAIN
    Object.assign(process.env, CONNECTION_ENV)
  })

  afterEach(() => {
    Object.keys(process.env).forEach((k) => delete process.env[k])
    Object.assign(process.env, originalEnv)
    vi.restoreAllMocks()
  })

  it("throws when connection env is incomplete", async () => {
    delete process.env.DB_KEY_SERVER_URL
    await expect(
      unwrapKeyFromKeyserver({
        wrappedKey: "wrap",
        label: "db",
        fetcher: vi.fn(),
        sleep: noopSleep,
      }),
    ).rejects.toThrow(/DB_KEY_SERVER_URL/)
  })

  it("rejects non-HTTPS key server URL", async () => {
    process.env.DB_KEY_SERVER_URL = "http://keys.example.com"
    await expect(
      unwrapKeyFromKeyserver({
        wrappedKey: "wrap",
        label: "db",
        fetcher: vi.fn(),
        sleep: noopSleep,
      }),
    ).rejects.toThrow(/https:\/\//)
  })

  it("returns passphrase on successful unwrap", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { passphrase: "secret-pass" }))
    await expect(
      unwrapKeyFromKeyserver({
        wrappedKey: "wrap-me",
        label: "db",
        fetcher,
        sleep: noopSleep,
      }),
    ).resolves.toBe("secret-pass")
    expect(fetcher).toHaveBeenCalledWith(
      "https://keys.example.com/unwrap",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
        body: JSON.stringify({ customer_id: "cust-1", wrapped_key: "wrap-me" }),
      }),
    )
  })

  it.each([401, 403, 422] as const)("does not retry on %s reject", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(status, "nope"))
    await expect(
      unwrapKeyFromKeyserver({
        wrappedKey: "wrap",
        label: "db",
        fetcher,
        sleep: noopSleep,
      }),
    ).rejects.toThrow(new RegExp(`Key server unwrap rejected \\(${status}\\)`))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("uses file-key wording for file label rejects", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(403, "nope"))
    await expect(
      unwrapKeyFromKeyserver({
        wrappedKey: "wrap",
        label: "file",
        fetcher,
        sleep: noopSleep,
      }),
    ).rejects.toThrow(/Key server file-key unwrap rejected \(403\)/)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("retries on 5xx then succeeds", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, "busy"))
      .mockResolvedValueOnce(jsonResponse(200, { passphrase: "after-retry" }))
    await expect(
      unwrapKeyFromKeyserver({
        wrappedKey: "wrap",
        label: "db",
        fetcher,
        sleep: noopSleep,
      }),
    ).resolves.toBe("after-retry")
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("does not retry empty passphrase", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { passphrase: "  " }))
    await expect(
      unwrapKeyFromKeyserver({
        wrappedKey: "wrap",
        label: "db",
        fetcher,
        sleep: noopSleep,
      }),
    ).rejects.toThrow(/empty passphrase/)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("falls back to HOST_ID for customer id", async () => {
    delete process.env.DB_KS_CUSTOMER_ID
    process.env.HOST_ID = "host-9"
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { passphrase: "ok" }))
    await unwrapKeyFromKeyserver({
      wrappedKey: "wrap",
      label: "db",
      fetcher,
      sleep: noopSleep,
    })
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      customer_id: "host-9",
      wrapped_key: "wrap",
    })
  })
})
