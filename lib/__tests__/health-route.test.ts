// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const probeKeyserverHealth = vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true }))
const getEncryptionMode = vi.fn((): "none" | "env" | "keyserver" => "none")
const emitHealthyFromHealthcheck = vi.fn()
const dbGet = vi.fn(() => ({ 1: 1 }))

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    prepare: () => ({ get: dbGet }),
  }),
}))

vi.mock("@/lib/encryption/db-key", () => ({
  probeKeyserverHealth: () => probeKeyserverHealth(),
}))

vi.mock("@/lib/encryption/mode", () => ({
  getEncryptionMode: () => getEncryptionMode(),
}))

vi.mock("@/lib/ops-health-log", () => ({
  emitHealthyFromHealthcheck: () => emitHealthyFromHealthcheck(),
}))

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.resetModules()
    probeKeyserverHealth.mockClear()
    probeKeyserverHealth.mockResolvedValue({ ok: true })
    getEncryptionMode.mockReturnValue("none")
    emitHealthyFromHealthcheck.mockClear()
    dbGet.mockClear()
    dbGet.mockReturnValue({ 1: 1 })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("mode none: 200, no keyserver fields, even with junk DB_KEY_SERVER_URL", async () => {
    getEncryptionMode.mockReturnValue("none")
    const prevUrl = process.env.DB_KEY_SERVER_URL
    process.env.DB_KEY_SERVER_URL = "not a url"
    try {
      const { GET } = await import("@/app/api/health/route")
      const res = await GET()
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ status: "ok", db: "connected" })
      expect(probeKeyserverHealth).not.toHaveBeenCalled()
      expect(emitHealthyFromHealthcheck).toHaveBeenCalledOnce()
    } finally {
      if (prevUrl === undefined) delete process.env.DB_KEY_SERVER_URL
      else process.env.DB_KEY_SERVER_URL = prevUrl
    }
  })

  it("mode env: 200, no keyserver fields", async () => {
    getEncryptionMode.mockReturnValue("env")
    const { GET } = await import("@/app/api/health/route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ status: "ok", db: "connected" })
    expect(probeKeyserverHealth).not.toHaveBeenCalled()
  })

  it("keyserver mode, probe ok: 200 with keyserver: reachable", async () => {
    getEncryptionMode.mockReturnValue("keyserver")
    probeKeyserverHealth.mockResolvedValue({ ok: true })
    const { GET } = await import("@/app/api/health/route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ status: "ok", db: "connected", keyserver: "reachable" })
    expect(emitHealthyFromHealthcheck).toHaveBeenCalledOnce()
  })

  it("keyserver mode, probe fails (unset URL): 503, no keyserver_detail, no error text", async () => {
    getEncryptionMode.mockReturnValue("keyserver")
    probeKeyserverHealth.mockResolvedValue({ ok: false, error: "DB_KEY_SERVER_URL not set" })
    const { GET } = await import("@/app/api/health/route")
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ status: "degraded", db: "connected", keyserver: "unreachable" })
    expect(JSON.stringify(body)).not.toContain("DB_KEY_SERVER_URL")
    expect(emitHealthyFromHealthcheck).not.toHaveBeenCalled()
  })

  it("keyserver mode, probe fails (HTTP error): 503, no error text leaked", async () => {
    getEncryptionMode.mockReturnValue("keyserver")
    probeKeyserverHealth.mockResolvedValue({ ok: false, error: "HTTP 502" })
    const { GET } = await import("@/app/api/health/route")
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain("502")
    expect(emitHealthyFromHealthcheck).not.toHaveBeenCalled()
  })

  it("keyserver mode, probe fails (thrown fetch error): 503, no error text leaked", async () => {
    getEncryptionMode.mockReturnValue("keyserver")
    probeKeyserverHealth.mockResolvedValue({ ok: false, error: "fetch failed: ECONNREFUSED" })
    const { GET } = await import("@/app/api/health/route")
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED")
    expect(emitHealthyFromHealthcheck).not.toHaveBeenCalled()
  })

  it("DB throw: 500, no path, no keyserver_detail, emitHealthyFromHealthcheck not called", async () => {
    dbGet.mockImplementation(() => {
      throw new Error("SQLITE_CANTOPEN: unable to open database file /app/data/familychart.db")
    })
    const { GET } = await import("@/app/api/health/route")
    const res = await GET()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ status: "error", db: "unreachable" })
    expect(JSON.stringify(body)).not.toContain("/app/data")
    expect(emitHealthyFromHealthcheck).not.toHaveBeenCalled()
  })
})

describe("docker-compose healthcheck status-code policy", () => {
  // Mirrors the exact predicate baked into docker-compose.yml's healthcheck test command:
  // r.statusCode === 200 || r.statusCode === 503 -> exit 0 (live), else exit 1 (unhealthy).
  function healthcheckExitCode(statusCode: number): number {
    return statusCode === 200 || statusCode === 503 ? 0 : 1
  }

  it("200 and 503 both count as container-live", () => {
    expect(healthcheckExitCode(200)).toBe(0)
    expect(healthcheckExitCode(503)).toBe(0)
  })

  it("500 fails the check", () => {
    expect(healthcheckExitCode(500)).toBe(1)
  })
})
