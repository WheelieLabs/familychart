import { afterEach, describe, expect, it, vi } from "vitest"
import {
  CREDENTIALS_PROVIDER_ALWAYS_ON,
  isEntraProviderEnabledViaEnv,
  parseEnabledAuthProviders,
} from "@/lib/auth/auth-providers"

describe("auth providers", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("credentials provider is always on", () => {
    expect(CREDENTIALS_PROVIDER_ALWAYS_ON).toBe(true)
  })

  it("defaults to credentials when ENABLED_AUTH_PROVIDERS unset", () => {
    vi.stubEnv("ENABLED_AUTH_PROVIDERS", "")
    expect(parseEnabledAuthProviders()).toEqual(["credentials"])
  })

  it("entra-only env still parses entra (credentials registered separately in auth.ts)", () => {
    vi.stubEnv("ENABLED_AUTH_PROVIDERS", "entra")
    expect(parseEnabledAuthProviders()).toEqual(["entra"])
    expect(isEntraProviderEnabledViaEnv()).toBe(true)
  })

  it("both providers when comma-separated", () => {
    vi.stubEnv("ENABLED_AUTH_PROVIDERS", "credentials, entra")
    expect(parseEnabledAuthProviders()).toEqual(["credentials", "entra"])
    expect(isEntraProviderEnabledViaEnv()).toBe(true)
  })
})
