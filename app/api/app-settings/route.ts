// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { isOutboundEmailConfigured } from "@/lib/email-send"
import { isManagedPlatformProfile } from "@/lib/platform-profile"
import { upsertAppSetting } from "@/lib/settings/app-settings-store"
import { resolveAllAppSettingsForAdmin } from "@/lib/settings/resolver"

export async function GET() {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult

  const db = getDb()
  const settings = resolveAllAppSettingsForAdmin(db)
  const managedOutboundEmail = isManagedPlatformProfile()
    ? { configured: isOutboundEmailConfigured(db) }
    : null

  return NextResponse.json({ settings, managedOutboundEmail })
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const body = await request.json().catch(() => ({}))
  const key = typeof body.key === "string" ? body.key : ""
  const value = typeof body.value === "string" ? body.value : ""

  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 })

  const result = upsertAppSetting(getDb(), key, value, session.user?.email)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json(result.resolved)
}
