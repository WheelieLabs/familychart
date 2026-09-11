// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireManage } from "@/lib/auth/auth-helpers"
import { rejectDemoProfanity } from "@/lib/demo/demo-profanity-guard"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"

interface Params { params: Promise<{ id: string }> }

export async function PUT(request: NextRequest, { params }: Params) {
  const authResult = await requireManage()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult

  const { id } = await params
  const body = await request.json()
  const { name, notes } = body
  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 })
  const profanity = await rejectDemoProfanity(name, notes)
  if (profanity) return profanity

  const db = getDb()
  db.prepare("UPDATE medication_groups SET name=?, notes=? WHERE id=?")
    .run(name.trim(), notes ?? null, parseInt(id, 10))
  auditLog(db, session.user?.email, "UPDATE", "medication_groups", parseInt(id, 10), body)
  return NextResponse.json({ success: true })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const authResult = await requireManage()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult

  const { id } = await params
  const db = getDb()
  const gid = parseInt(id, 10)

  const linked = db.prepare(
    `SELECT COUNT(*) as count FROM medication_group_members mgm
     JOIN medications m ON m.id = mgm.medication_id AND m.is_active = 1
     WHERE mgm.group_id = ?`
  ).get(gid) as { count: number }

  if (linked.count > 0) {
    return NextResponse.json(
      { error: `Cannot delete — ${linked.count} medication${linked.count === 1 ? "" : "s"} are linked to this group` },
      { status: 400 }
    )
  }

  db.prepare("UPDATE medication_groups SET is_active = 0 WHERE id = ?").run(gid)
  auditLog(db, session.user?.email, "DELETE", "medication_groups", gid)
  return NextResponse.json({ success: true })
}
