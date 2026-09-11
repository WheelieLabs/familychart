// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest"
import {
  GENERIC_EMAIL_SEND_ERROR,
  isBlockedSmtpHost,
  isValidSmtpHost,
} from "@/lib/smtp-host"
import { sendOutboundEmail } from "@/lib/email-send"

vi.mock("@/lib/platform-profile", () => ({
  isManagedPlatformProfile: () => false,
}))

vi.mock("@/lib/smtp-client", () => ({
  loadSmtpConfig: () => ({
    host: "smtp.example.com",
    port: 587,
    secure: false,
    user: "u",
    password: "p",
  }),
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const sendMail = vi.fn()
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail }),
  },
}))

describe("isBlockedSmtpHost / isValidSmtpHost", () => {
  it("allows public and typical LAN hosts", () => {
    expect(isValidSmtpHost("smtp.gmail.com")).toBe(true)
    expect(isValidSmtpHost("mail.lan")).toBe(true)
    expect(isValidSmtpHost("192.168.1.10")).toBe(true)
    expect(isValidSmtpHost("10.0.0.5")).toBe(true)
    expect(isValidSmtpHost("127.0.0.1")).toBe(true)
    expect(isValidSmtpHost("localhost")).toBe(true)
    expect(isBlockedSmtpHost("smtp.example.com")).toBe(false)
  })

  it("rejects cloud metadata and link-local literals", () => {
    expect(isValidSmtpHost("169.254.169.254")).toBe(false)
    expect(isValidSmtpHost("169.254.0.1")).toBe(false)
    expect(isValidSmtpHost("metadata.google.internal")).toBe(false)
    expect(isValidSmtpHost("168.63.129.16")).toBe(false)
    expect(isValidSmtpHost("fe80::1")).toBe(false)
    expect(isValidSmtpHost("")).toBe(false)
  })
})

describe("sendOutboundEmail error redaction", () => {
  afterEach(() => {
    sendMail.mockReset()
  })

  it("returns a generic client error and does not echo transport banners", async () => {
    sendMail.mockRejectedValueOnce(
      new Error("Invalid greeting. response=SSH-2.0-OpenSSH_8.9"),
    )
    const result = await sendOutboundEmail({} as never, {
      to: "a@example.com",
      subject: "t",
      text: "b",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe(GENERIC_EMAIL_SEND_ERROR)
      expect(result.error).not.toContain("SSH")
      expect(result.error).not.toContain("Invalid greeting")
    }
  })
})
