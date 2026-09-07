import { afterEach, describe, expect, it, vi } from "vitest"
import {
  isBehindReverseProxy,
  nextAuthTrustHost,
  nextAuthUseSecureCookies,
  publicOrigin,
} from "@/lib/reverse-proxy"

function headers(values: Record<string, string>) {
  return { get: (name: string) => values[name.toLowerCase()] ?? null }
}

describe("reverse-proxy mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("defaults to direct exposure when unset", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("BEHIND_REVERSE_PROXY", "")
    vi.stubEnv("NEXTAUTH_USE_SECURE_COOKIES", "")
    expect(isBehindReverseProxy()).toBe(false)
    expect(nextAuthTrustHost()).toBe(false)
    expect(nextAuthUseSecureCookies()).toBe(true)
  })

  it("enables NextAuth host trust and non-secure cookies in next dev", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("BEHIND_REVERSE_PROXY", "")
    expect(isBehindReverseProxy()).toBe(false)
    expect(nextAuthTrustHost()).toBe(true)
    expect(nextAuthUseSecureCookies()).toBe(false)
  })

  it("enables proxy mode when BEHIND_REVERSE_PROXY=true, but secure cookies stay on", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("BEHIND_REVERSE_PROXY", "true")
    expect(isBehindReverseProxy()).toBe(true)
    expect(nextAuthTrustHost()).toBe(true)
    expect(nextAuthUseSecureCookies()).toBe(true)
  })

  it("legacy NEXTAUTH_USE_SECURE_COOKIES=false implies behind proxy", () => {
    vi.stubEnv("BEHIND_REVERSE_PROXY", "")
    vi.stubEnv("NEXTAUTH_USE_SECURE_COOKIES", "false")
    expect(isBehindReverseProxy()).toBe(true)
  })

  it("explicit BEHIND_REVERSE_PROXY=false overrides legacy secure cookies", () => {
    vi.stubEnv("BEHIND_REVERSE_PROXY", "false")
    vi.stubEnv("NEXTAUTH_USE_SECURE_COOKIES", "false")
    expect(isBehindReverseProxy()).toBe(false)
  })
})

describe("publicOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("behind a reverse proxy, uses X-Forwarded-Host/Proto over the app's own bind address", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("BEHIND_REVERSE_PROXY", "true")
    const h = headers({ "x-forwarded-host": "family.example.com", "x-forwarded-proto": "https", host: "0.0.0.0:3000" })
    expect(publicOrigin(h, "http://0.0.0.0:3000")).toBe("https://family.example.com")
  })

  it("behind a reverse proxy without forwarded headers, falls back to Host", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("BEHIND_REVERSE_PROXY", "true")
    const h = headers({ host: "family.example.com" })
    expect(publicOrigin(h, "http://0.0.0.0:3000")).toBe("https://family.example.com")
  })

  it("not behind a reverse proxy, uses NEXTAUTH_URL instead of the request's own origin", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("BEHIND_REVERSE_PROXY", "")
    vi.stubEnv("NEXTAUTH_URL", "https://family.example.com")
    const h = headers({ host: "0.0.0.0:3000" })
    expect(publicOrigin(h, "http://0.0.0.0:3000")).toBe("https://family.example.com")
  })

  it("falls back to the caller-supplied origin when nothing else is configured", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("BEHIND_REVERSE_PROXY", "")
    vi.stubEnv("NEXTAUTH_URL", "")
    const h = headers({ host: "0.0.0.0:3000" })
    expect(publicOrigin(h, "http://0.0.0.0:3000")).toBe("http://0.0.0.0:3000")
  })
})
