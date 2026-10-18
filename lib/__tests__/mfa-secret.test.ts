import { describe, it, expect } from "vitest"
import { otpauthSecret, formatSecret } from "@/lib/mfa-secret"

describe("otpauthSecret", () => {
  it("reads the secret from an otpauth URI", () => {
    expect(otpauthSecret("otpauth://totp/FamilyChart:a%40b.c?secret=JBSWY3DPEHPK3PXP&issuer=FamilyChart")).toBe("JBSWY3DPEHPK3PXP")
  })
  it("returns null for missing, empty or malformed input", () => {
    expect(otpauthSecret(null)).toBeNull()
    expect(otpauthSecret("otpauth://totp/x?issuer=y")).toBeNull()
    expect(otpauthSecret("not a uri")).toBeNull()
  })
})

describe("formatSecret", () => {
  it("groups in fours without a trailing space", () => {
    expect(formatSecret("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP")
    expect(formatSecret("ABCDEF")).toBe("ABCD EF")
  })
})
