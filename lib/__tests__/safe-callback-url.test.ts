import { describe, expect, it } from "vitest"
import { safeRelativeCallbackUrl } from "@/lib/safe-callback-url"

describe("safeRelativeCallbackUrl", () => {
  it("allows legitimate relative paths", () => {
    expect(safeRelativeCallbackUrl("/")).toBe("/")
    expect(safeRelativeCallbackUrl("/profile?tab=account")).toBe("/profile?tab=account")
  })

  it("falls back on missing/empty input", () => {
    expect(safeRelativeCallbackUrl(null)).toBe("/")
    expect(safeRelativeCallbackUrl(undefined)).toBe("/")
    expect(safeRelativeCallbackUrl("")).toBe("/")
  })

  it("rejects protocol-relative URLs", () => {
    expect(safeRelativeCallbackUrl("//evil.com")).toBe("/")
    expect(safeRelativeCallbackUrl("///evil.com")).toBe("/")
  })

  it("rejects backslash tricks", () => {
    expect(safeRelativeCallbackUrl("/\\evil.com")).toBe("/")
  })

  it("rejects absolute URLs", () => {
    expect(safeRelativeCallbackUrl("https://evil.com")).toBe("/")
    expect(safeRelativeCallbackUrl("http://evil.com/")).toBe("/")
  })

  it("rejects non-leading-slash values", () => {
    expect(safeRelativeCallbackUrl("evil.com")).toBe("/")
  })

  it("supports a custom fallback", () => {
    expect(safeRelativeCallbackUrl("//evil.com", "/dashboard")).toBe("/dashboard")
  })
})
