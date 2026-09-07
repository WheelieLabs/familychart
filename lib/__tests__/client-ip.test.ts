import { afterEach, describe, expect, it, vi } from "vitest"
import { clientIpFromHeaders, trustedProxyDepth } from "@/lib/client-ip"

function headers(map: Record<string, string>) {
  return {
    get(name: string): string | null {
      return map[name.toLowerCase()] ?? null
    },
  }
}

describe("trustedProxyDepth", () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it("defaults to 1", () => {
    vi.stubEnv("TRUST_PROXY_DEPTH", "")
    expect(trustedProxyDepth()).toBe(1)
  })

  it("reads a valid positive depth", () => {
    vi.stubEnv("TRUST_PROXY_DEPTH", "2")
    expect(trustedProxyDepth()).toBe(2)
  })

  it("falls back to 1 for invalid values", () => {
    vi.stubEnv("TRUST_PROXY_DEPTH", "0")
    expect(trustedProxyDepth()).toBe(1)
    vi.stubEnv("TRUST_PROXY_DEPTH", "nope")
    expect(trustedProxyDepth()).toBe(1)
  })
})

describe("clientIpFromHeaders", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns unknown when not behind a reverse proxy", () => {
    vi.stubEnv("BEHIND_REVERSE_PROXY", "false")
    const ip = clientIpFromHeaders(headers({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }), 1)
    expect(ip).toBe("unknown")
  })

  it("takes the rightmost entry with a single trusted proxy (spoof-resistant)", () => {
    vi.stubEnv("BEHIND_REVERSE_PROXY", "true")
    // Attacker prepends a spoofed value; the proxy appends the real connecting IP.
    const ip = clientIpFromHeaders(headers({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }), 1)
    expect(ip).toBe("9.9.9.9")
  })

  it("a rotated spoofed left entry does not change the derived IP", () => {
    vi.stubEnv("BEHIND_REVERSE_PROXY", "true")
    const a = clientIpFromHeaders(headers({ "x-forwarded-for": "1.1.1.1, 9.9.9.9" }), 1)
    const b = clientIpFromHeaders(headers({ "x-forwarded-for": "2.2.2.2, 9.9.9.9" }), 1)
    expect(a).toBe(b)
  })

  it("honours a deeper trusted-proxy chain", () => {
    vi.stubEnv("BEHIND_REVERSE_PROXY", "true")
    const ip = clientIpFromHeaders(headers({ "x-forwarded-for": "client, edge, app" }), 2)
    expect(ip).toBe("edge")
  })

  it("falls back to x-real-ip then unknown", () => {
    vi.stubEnv("BEHIND_REVERSE_PROXY", "true")
    expect(clientIpFromHeaders(headers({ "x-real-ip": "5.5.5.5" }), 1)).toBe("5.5.5.5")
    expect(clientIpFromHeaders(headers({}), 1)).toBe("unknown")
  })
})
