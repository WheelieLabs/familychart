// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { isSetupComplete, setSetupComplete } from "@/lib/setup-gate"
import { resolveInstanceTimezone } from "@/lib/instance-timezone"
import { upsertAppSetting } from "@/lib/settings/app-settings-store"
import {
  isValidIanaTz,
  SETTING_EMAIL_SMTP_HOST,
  SETTING_EMAIL_SMTP_PASSWORD,
  SETTING_EMAIL_SMTP_PORT,
  SETTING_EMAIL_SMTP_TLS,
  SETTING_EMAIL_SMTP_USER,
  SETTING_LOCALE_DEFAULT_TIMEZONE,
} from "@/lib/settings/registry"
import { resolveSetting } from "@/lib/settings/resolver"
import { seedVapidSubjectFromEmail } from "@/lib/vapid-config"

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const db = getDb()
  if (isSetupComplete(db)) {
    return NextResponse.json({ ok: true })
  }

  let body: {
    timezone?: string
    smtp?: {
      host?: string
      port?: string
      user?: string
      password?: string
      tls?: string
    }
  } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    body = {}
  }

  if (!resolveInstanceTimezone(db)) {
    const timezone = typeof body.timezone === "string" ? body.timezone.trim() : ""
    if (!timezone) {
      return NextResponse.json({ error: "timezone is required" }, { status: 400 })
    }
    if (!isValidIanaTz(timezone)) {
      return NextResponse.json({ error: "Invalid timezone" }, { status: 400 })
    }

    const current = resolveSetting(db, SETTING_LOCALE_DEFAULT_TIMEZONE)
    if (current.locked) {
      return NextResponse.json({ error: "Instance timezone not configured" }, { status: 400 })
    }

    const saved = upsertAppSetting(db, SETTING_LOCALE_DEFAULT_TIMEZONE, timezone, session.user?.email)
    if (!saved.ok) {
      return NextResponse.json({ error: saved.error }, { status: saved.status })
    }

    if (!resolveInstanceTimezone(db)) {
      return NextResponse.json({ error: "Instance timezone not configured" }, { status: 400 })
    }
  }

  const smtp = body.smtp
  if (smtp && typeof smtp === "object") {
    const entries: [string, string][] = []
    if (typeof smtp.host === "string" && smtp.host.trim()) {
      entries.push([SETTING_EMAIL_SMTP_HOST, smtp.host.trim()])
    }
    if (typeof smtp.port === "string" && smtp.port.trim()) {
      entries.push([SETTING_EMAIL_SMTP_PORT, smtp.port.trim()])
    }
    if (typeof smtp.user === "string") {
      entries.push([SETTING_EMAIL_SMTP_USER, smtp.user.trim()])
    }
    if (typeof smtp.password === "string" && smtp.password.trim()) {
      entries.push([SETTING_EMAIL_SMTP_PASSWORD, smtp.password.trim()])
    }
    if (typeof smtp.tls === "string" && (smtp.tls === "true" || smtp.tls === "false")) {
      entries.push([SETTING_EMAIL_SMTP_TLS, smtp.tls])
    }
    for (const [key, value] of entries) {
      const current = resolveSetting(db, key)
      if (current.locked) continue
      const saved = upsertAppSetting(db, key, value, session.user?.email)
      if (!saved.ok) {
        return NextResponse.json({ error: saved.error }, { status: saved.status })
      }
    }
  }

  seedVapidSubjectFromEmail(db, session.user?.email)

  setSetupComplete(db, session.user?.email)
  return NextResponse.json({ ok: true })
}
