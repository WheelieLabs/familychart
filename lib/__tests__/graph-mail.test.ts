// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  graphMailConfigured,
  loadGraphMailConfig,
  managedMailFromAddress,
  sendGraphMail,
} from "@/lib/graph-mail"

describe("graph mail (managed)", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.FC_PLATFORM_PROFILE = "managed"
    process.env.HOST_ID = "acme"
    process.env.FC_GRAPH_MAIL_TENANT_ID = "tenant-id"
    process.env.FC_GRAPH_MAIL_CLIENT_ID = "client-id"
    process.env.FC_GRAPH_MAIL_CLIENT_SECRET = "client-secret"
  })

  afterEach(() => {
    Object.keys(process.env).forEach(k => delete process.env[k])
    Object.assign(process.env, originalEnv)
    vi.restoreAllMocks()
  })

  it("derives From address from HOST_ID", () => {
    expect(managedMailFromAddress()).toBe("acme@familychart.app")
  })

  it("graphMailConfigured when FC_GRAPH_MAIL_* set", () => {
    expect(graphMailConfigured()).toBe(true)
    expect(loadGraphMailConfig()?.fromAddress).toBe("acme@familychart.app")
  })

  it("graphMailConfigured false when creds missing", () => {
    delete process.env.FC_GRAPH_MAIL_CLIENT_SECRET
    expect(graphMailConfigured()).toBe(false)
  })

  it("sendGraphMail posts to Graph sendMail endpoint", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({ ok: true, status: 202 })
    vi.stubGlobal("fetch", fetchMock)

    const cfg = loadGraphMailConfig()!
    await sendGraphMail(cfg, {
      to: "admin@example.com",
      subject: "Test",
      text: "Hello",
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      encodeURIComponent("acme@familychart.app"),
    )
  })
})
