// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireManage } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"

interface Params {
  params: Promise<{ id: string }>
}

const METADATA_KEYS = [
  "observation_type",
  "is_static",
  "chart_type",
  "typical_unit",
  "sort_order",
  "max_age_years",
  "stale_after_hours",
] as const

function parseIsActive(value: unknown): 0 | 1 | null {
  if (value === 1 || value === true || value === "1") return 1
  if (value === 0 || value === false || value === "0") return 0
  return null
}

/** Toggle catalogue visibility only — metadata lives in code / seed migrations. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const authResult = await requireManage()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

  for (const key of METADATA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      return NextResponse.json(
        { error: "Only is_active may be updated on observation type config" },
        { status: 400 },
      )
    }
  }

  if (!Object.prototype.hasOwnProperty.call(body, "is_active")) {
    return NextResponse.json({ error: "is_active is required" }, { status: 400 })
  }

  const isActive = parseIsActive(body.is_active)
  if (isActive === null) {
    return NextResponse.json({ error: "is_active must be 0 or 1" }, { status: 400 })
  }

  const db = getDb()
  const row = db
    .prepare("SELECT id, observation_type FROM observation_type_config WHERE id = ?")
    .get(id) as { id: number; observation_type: string } | undefined
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })

  db.prepare("UPDATE observation_type_config SET is_active = ? WHERE id = ?").run(isActive, id)
  auditLog(db, session.user?.email, "UPDATE", "observation_type_config", id, {
    observation_type: row.observation_type,
    is_active: isActive,
  })

  return NextResponse.json({ ok: true, is_active: isActive })
}

/**
 * Soft-deactivate only. Catalogue rows are never hard-deleted — hide via is_active = 0.
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const authResult = await requireManage()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const db = getDb()
  const row = db
    .prepare("SELECT id, observation_type FROM observation_type_config WHERE id = ?")
    .get(id) as { id: number; observation_type: string } | undefined
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })

  db.prepare("UPDATE observation_type_config SET is_active = 0 WHERE id = ?").run(id)
  auditLog(db, session.user?.email, "UPDATE", "observation_type_config", id, {
    action: "deactivate",
    observation_type: row.observation_type,
  })
  return NextResponse.json({ ok: true, action: "deactivated" as const })
}
