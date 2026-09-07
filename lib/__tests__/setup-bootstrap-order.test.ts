// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const rejectDemoProfanity = vi.fn(async (): Promise<NextResponse | null> => null)
const isBootstrapEndpointAllowed = vi.fn(() => true)
const createFirstAdmin = vi.fn()
const isSetupComplete = vi.fn(() => false)
const isAdminSeen = vi.fn(() => false)
const hasAnyLocalAccount = vi.fn(() => false)
const isEmailTakenByAnyAccount = vi.fn(() => false)
const validateNewPassword = vi.fn(() => null as string | null)
const isBootstrapRateLimited = vi.fn(() => false)
const recordBootstrapAttempt = vi.fn()

vi.mock("@/lib/demo/demo-profanity-guard", () => ({
  rejectDemoProfanity: (...args: unknown[]) =>
    rejectDemoProfanity(...(args as Parameters<typeof rejectDemoProfanity>)),
}))

vi.mock("@/lib/setup-bootstrap", () => ({
  isBootstrapEndpointAllowed: () => isBootstrapEndpointAllowed(),
  createFirstAdmin: (...args: unknown[]) => createFirstAdmin(...(args as Parameters<typeof createFirstAdmin>)),
}))

vi.mock("@/lib/setup-gate", () => ({
  isSetupComplete: () => isSetupComplete(),
  isAdminSeen: () => isAdminSeen(),
}))

vi.mock("@/lib/local-account-gate", () => ({
  hasAnyLocalAccount: () => hasAnyLocalAccount(),
  isEmailTakenByAnyAccount: (...args: unknown[]) =>
    isEmailTakenByAnyAccount(...(args as Parameters<typeof isEmailTakenByAnyAccount>)),
}))

vi.mock("@/lib/password-policy", () => ({
  validateNewPassword: (...args: unknown[]) =>
    validateNewPassword(...(args as Parameters<typeof validateNewPassword>)),
}))

vi.mock("@/lib/auth/auth-rate-limit", () => ({
  isBootstrapRateLimited: (...args: unknown[]) =>
    isBootstrapRateLimited(...(args as Parameters<typeof isBootstrapRateLimited>)),
  recordBootstrapAttempt: (...args: unknown[]) =>
    recordBootstrapAttempt(...(args as Parameters<typeof recordBootstrapAttempt>)),
}))

vi.mock("@/lib/db", () => ({
  getDb: () => ({}),
}))

describe("POST /api/setup/bootstrap pipeline order vs demo profanity", () => {
  beforeEach(() => {
    vi.resetModules()
    rejectDemoProfanity.mockClear()
    rejectDemoProfanity.mockResolvedValue(null)
    isBootstrapEndpointAllowed.mockReturnValue(true)
    createFirstAdmin.mockReset()
    isSetupComplete.mockReturnValue(false)
    isAdminSeen.mockReturnValue(false)
    hasAnyLocalAccount.mockReturnValue(false)
    isEmailTakenByAnyAccount.mockReturnValue(false)
    validateNewPassword.mockReturnValue(null)
    isBootstrapRateLimited.mockReturnValue(false)
    recordBootstrapAttempt.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  function makeRequest() {
    return new NextRequest("http://localhost/api/setup/bootstrap", {
      method: "POST",
      body: JSON.stringify({
        email: "admin@example.com",
        password: "a-strong-new-password",
        confirmPassword: "a-strong-new-password",
      }),
      headers: { "content-type": "application/json" },
    })
  }

  it("short-circuits on setup already complete", async () => {
    isSetupComplete.mockReturnValue(true)
    const { POST } = await import("@/app/api/setup/bootstrap/route")
    const res = await POST(makeRequest())
    expect(res.status).toBe(403)
    expect(rejectDemoProfanity).not.toHaveBeenCalled()
  })

  it("short-circuits on an administrator already existing", async () => {
    isAdminSeen.mockReturnValue(true)
    const { POST } = await import("@/app/api/setup/bootstrap/route")
    const res = await POST(makeRequest())
    expect(res.status).toBe(403)
    expect(rejectDemoProfanity).not.toHaveBeenCalled()
  })

  it("short-circuits on local accounts already existing", async () => {
    hasAnyLocalAccount.mockReturnValue(true)
    const { POST } = await import("@/app/api/setup/bootstrap/route")
    const res = await POST(makeRequest())
    expect(res.status).toBe(403)
    expect(rejectDemoProfanity).not.toHaveBeenCalled()
  })

  it("short-circuits on an email already taken", async () => {
    isEmailTakenByAnyAccount.mockReturnValue(true)
    const { POST } = await import("@/app/api/setup/bootstrap/route")
    const res = await POST(makeRequest())
    expect(res.status).toBe(409)
    expect(rejectDemoProfanity).not.toHaveBeenCalled()
  })

  it("short-circuits on an invalid password", async () => {
    validateNewPassword.mockReturnValue("Password too weak")
    const { POST } = await import("@/app/api/setup/bootstrap/route")
    const res = await POST(makeRequest())
    expect(res.status).toBe(400)
    expect(rejectDemoProfanity).not.toHaveBeenCalled()
  })

  it("short-circuits when rate limited, without consuming rate-limit budget for earlier pre-checks", async () => {
    isBootstrapRateLimited.mockReturnValue(true)
    const { POST } = await import("@/app/api/setup/bootstrap/route")
    const res = await POST(makeRequest())
    expect(res.status).toBe(429)
    expect(rejectDemoProfanity).not.toHaveBeenCalled()
  })

  it("reaches the demo profanity guard exactly once for a fully valid request", async () => {
    rejectDemoProfanity.mockResolvedValue(
      NextResponse.json({ error: "This content is not allowed in the demo environment." }, { status: 400 }),
    )

    const { POST } = await import("@/app/api/setup/bootstrap/route")
    const res = await POST(makeRequest())

    expect(res.status).toBe(400)
    expect(rejectDemoProfanity).toHaveBeenCalledOnce()
    expect(recordBootstrapAttempt).toHaveBeenCalledOnce()
    expect(createFirstAdmin).not.toHaveBeenCalled()
  })
})
