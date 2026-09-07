// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { isManagedPlatformProfile } from "@/lib/platform-profile"
import { graphMailConfigured, loadGraphMailConfig, sendGraphMail } from "@/lib/graph-mail"
import { loadSmtpConfig } from "@/lib/smtp-client"
import { GENERIC_EMAIL_SEND_ERROR, isBlockedSmtpHost } from "@/lib/smtp-host"
import { logger } from "@/lib/logger"
import { testEmailHtml } from "@/lib/email-templates"
import nodemailer from "nodemailer"

export function isOutboundEmailConfigured(db: Database.Database): boolean {
  if (isManagedPlatformProfile()) return graphMailConfigured()
  return loadSmtpConfig(db) !== null
}

export async function sendOutboundEmail(
  db: Database.Database,
  opts: { to: string; subject: string; text: string; html?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (isManagedPlatformProfile()) {
      const cfg = loadGraphMailConfig()
      if (!cfg) {
        return { ok: false, error: "Platform Graph mail is not configured on this instance" }
      }
      await sendGraphMail(cfg, opts)
      return { ok: true }
    }

    const smtp = loadSmtpConfig(db)
    if (!smtp) {
      return { ok: false, error: "SMTP is not fully configured" }
    }

    if (isBlockedSmtpHost(smtp.host)) {
      logger.warn("smtp_host_blocked", { host: smtp.host })
      return { ok: false, error: GENERIC_EMAIL_SEND_ERROR }
    }

    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    })

    await transport.sendMail({
      from: smtp.user || `familychart@${smtp.host}`,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    })
    return { ok: true }
  } catch (err) {
    // Never echo nodemailer/transport banners to the client — they can leak internal SMTP details.
    logger.error("outbound_email_failed", err instanceof Error ? err : { detail: String(err) })
    return { ok: false, error: GENERIC_EMAIL_SEND_ERROR }
  }
}

/**
 * Pure content builder for `sendTestEmail`, split out so its copy/rendering is unit-testable
 * without a live SMTP/Graph send. Renders through the same shared shell as the invite email
 * rather than a second, admin-style alert shell.
 */
export function buildTestEmail(): { subject: string; text: string; html: string } {
  const statusLine = isManagedPlatformProfile()
    ? "This is a test message from your managed FamilyChart instance. Graph mail is working."
    : "This is a test message from your FamilyChart instance. SMTP is working."

  return {
    subject: "FamilyChart email test",
    text: statusLine,
    html: testEmailHtml({ statusLine }),
  }
}

export async function sendTestEmail(
  db: Database.Database,
  to: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return sendOutboundEmail(db, { to, ...buildTestEmail() })
}
