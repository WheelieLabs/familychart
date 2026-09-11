// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import { escapeHtml, inviteEmailHtml, testEmailHtml } from "@/lib/email-templates"

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<script>alert("hi") & 'bye'</script>`)).toBe(
      "&lt;script&gt;alert(&quot;hi&quot;) &amp; &#39;bye&#39;&lt;/script&gt;",
    )
  })

  it("leaves plain text untouched", () => {
    expect(escapeHtml("Ben")).toBe("Ben")
  })
})

describe("inviteEmailHtml", () => {
  const acceptUrl = "https://demo.familychart.app/accept-invite#token=abc123"

  it("includes the hero heading, subline, and CTA", () => {
    const html = inviteEmailHtml({ inviter: { kind: "name", value: "Ben" }, acceptUrl })
    expect(html).toContain("You're invited to FamilyChart")
    expect(html).toContain("You've been invited to create a FamilyChart account")
    expect(html).toContain(">Accept invite<")
    expect(html).toContain(acceptUrl)
  })

  it("names the inviter directly for the name branch", () => {
    const html = inviteEmailHtml({ inviter: { kind: "name", value: "Ben" }, acceptUrl })
    expect(html).toContain("<strong>Ben</strong> has invited you to join their family's FamilyChart instance.")
    expect(html).toContain("expires in 7 days and can only be used once")
  })

  it("uses the alternate sentence shape for the email-fallback branch", () => {
    const html = inviteEmailHtml({ inviter: { kind: "email", value: "ben@example.com" }, acceptUrl })
    expect(html).toContain("You've been invited by <strong>ben@example.com</strong> to join a FamilyChart instance.")
    expect(html).not.toContain("their family's")
  })

  it("HTML-escapes an inviter name/email containing markup", () => {
    const html = inviteEmailHtml({ inviter: { kind: "name", value: "<b>Ben</b>" }, acceptUrl })
    expect(html).toContain("&lt;b&gt;Ben&lt;/b&gt;")
    expect(html).not.toContain("<b>Ben</b> has invited")
  })

  it("includes a plain-text link fallback in the footer", () => {
    const html = inviteEmailHtml({ inviter: { kind: "name", value: "Ben" }, acceptUrl })
    expect(html).toContain(`href="${acceptUrl}"`)
  })
})

describe("testEmailHtml", () => {
  it("includes the generic test hero and the given status line", () => {
    const html = testEmailHtml({ statusLine: "This is a test message from your FamilyChart instance. SMTP is working." })
    expect(html).toContain("FamilyChart email test")
    expect(html).toContain("This is a test message from your FamilyChart instance. SMTP is working.")
  })

  it("HTML-escapes the status line", () => {
    const html = testEmailHtml({ statusLine: "<script>alert(1)</script>" })
    expect(html).toContain("&lt;script&gt;")
    expect(html).not.toContain("<script>alert(1)</script>")
  })
})
