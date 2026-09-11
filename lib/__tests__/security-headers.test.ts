// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import { NextResponse } from "next/server"
import { applySecurityHeaders, SECURITY_HEADERS } from "@/lib/security-headers"

describe("applySecurityHeaders", () => {
  it("sets every header from SECURITY_HEADERS on the response", () => {
    const response = applySecurityHeaders(NextResponse.next())

    for (const { key, value } of SECURITY_HEADERS) {
      expect(response.headers.get(key)).toBe(value)
    }
  })

  it("returns the same response instance it was given", () => {
    const response = NextResponse.next()
    expect(applySecurityHeaders(response)).toBe(response)
  })

  it("pins the framework-neutral headers to their expected fixed values", () => {
    const response = applySecurityHeaders(NextResponse.next())
    expect(response.headers.get("X-Frame-Options")).toBe("DENY")
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin")
  })

  it("includes base-uri, form-action, and object-src in the CSP (not covered by default-src)", () => {
    const csp = SECURITY_HEADERS.find(h => h.key === "Content-Security-Policy")?.value ?? ""
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
  })
})
