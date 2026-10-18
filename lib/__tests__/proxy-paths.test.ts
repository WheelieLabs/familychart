import { describe, expect, it } from "vitest"
import { isPageAllowedBeforeSetupComplete, isSessionExemptPage } from "@/lib/proxy-paths"

describe("isSessionExemptPage", () => {
  it("allows setup, the managed-admin reset-password page, and invite acceptance", () => {
    expect(isSessionExemptPage("/setup")).toBe(true)
    expect(isSessionExemptPage("/reset-password")).toBe(true)
    expect(isSessionExemptPage("/accept-invite")).toBe(true)
  })

  it("allows the invite-accept API route, since it isn't under the matcher-excluded api/auth prefix", () => {
    expect(isSessionExemptPage("/api/accounts/invites/accept")).toBe(true)
  })

  it("lets the restore screen open during setup and keeps every other page on the wizard", () => {
    expect(isPageAllowedBeforeSetupComplete("/setup")).toBe(true)
    expect(isPageAllowedBeforeSetupComplete("/admin/export")).toBe(true)
    expect(isPageAllowedBeforeSetupComplete("/admin/export/3/erase")).toBe(false)
    expect(isPageAllowedBeforeSetupComplete("/")).toBe(false)
    expect(isPageAllowedBeforeSetupComplete("/profile")).toBe(false)
  })

  it("does not exempt login (matcher-excluded) or authenticated app paths", () => {
    expect(isSessionExemptPage("/login")).toBe(false)
    expect(isSessionExemptPage("/")).toBe(false)
    expect(isSessionExemptPage("/profile")).toBe(false)
    expect(isSessionExemptPage("/api/auth/reset-password")).toBe(false)
    expect(isSessionExemptPage("/api/accounts/invites")).toBe(false)
  })
})
