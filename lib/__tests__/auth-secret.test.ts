import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { validateNextAuthSecretAtBoot, WEAK_NEXTAUTH_SECRETS } from "@/lib/auth/auth-secret"

describe("validateNextAuthSecretAtBoot", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("skips validation outside production", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("NEXTAUTH_SECRET", "")
    expect(() => validateNextAuthSecretAtBoot()).not.toThrow()
  })

  it("rejects missing secret in production", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXTAUTH_SECRET", "")
    expect(() => validateNextAuthSecretAtBoot()).toThrow(/NEXTAUTH_SECRET is required/)
  })

  it("rejects short secret in production", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXTAUTH_SECRET", "short")
    expect(() => validateNextAuthSecretAtBoot()).toThrow(/at least 32/)
  })

  it("rejects known placeholders in production", () => {
    vi.stubEnv("NODE_ENV", "production")
    for (const weak of WEAK_NEXTAUTH_SECRETS) {
      vi.stubEnv("NEXTAUTH_SECRET", weak)
      expect(() => validateNextAuthSecretAtBoot()).toThrow(/placeholder/)
    }
  })

  it("accepts a strong secret in production", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXTAUTH_SECRET", "a".repeat(32))
    expect(() => validateNextAuthSecretAtBoot()).not.toThrow()
  })
})
