// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { isSetupComplete } from "@/lib/setup-gate"
import { resolveInstanceTimezone } from "@/lib/instance-timezone"
import { upsertAppSetting } from "@/lib/settings/app-settings-store"
import { isValidIanaTz, SETTING_LOCALE_DEFAULT_TIMEZONE } from "@/lib/settings/registry"
import { resolveSetting } from "@/lib/settings/resolver"

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  if (isSetupComplete(getDb())) {
    return NextResponse.json({ ok: true })
  }

  let body: { timezone?: string }
  try {
    body = (await request.json()) as { timezone?: string }
  } catch {
    body = {}
  }

  const timezone = typeof body.timezone === "string" ? body.timezone.trim() : ""
  if (!timezone) {
    return NextResponse.json({ error: "timezone is required" }, { status: 400 })
  }
  if (!isValidIanaTz(timezone)) {
    return NextResponse.json({ error: "Invalid timezone" }, { status: 400 })
  }

  const db = getDb()
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

  return NextResponse.json({ ok: true })
}
