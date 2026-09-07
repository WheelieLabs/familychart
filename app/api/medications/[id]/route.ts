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
  const mid = parseInt(id, 10)
  const body = await request.json()
  const { name, default_dosage, dosage_unit, notes, min_age_years, max_age_years, group_ids, is_active } = body
  const profanity = await rejectDemoProfanity(name, notes)
  if (profanity) return profanity
  const db = getDb()

  db.prepare(
    "UPDATE medications SET name=?, default_dosage=?, dosage_unit=?, notes=?, min_age_years=?, max_age_years=?, is_active=? WHERE id=?"
  ).run(name, default_dosage ?? null, dosage_unit ?? "Tabs",
        notes ?? null, min_age_years ?? null, max_age_years ?? null,
        is_active === false || is_active === 0 ? 0 : 1, mid)

  // Sync group memberships
  db.prepare("DELETE FROM medication_group_members WHERE medication_id = ?").run(mid)
  const insertMember = db.prepare(
    "INSERT OR IGNORE INTO medication_group_members (medication_id, group_id) VALUES (?, ?)"
  )
  for (const gid of (Array.isArray(group_ids) ? group_ids : [])) {
    insertMember.run(mid, gid)
  }

  auditLog(db, session.user?.email, "UPDATE", "medications", mid, { ...body, group_ids })
  return NextResponse.json({ success: true })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const authResult = await requireManage()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult
  const { id } = await params
  const mid = parseInt(id, 10)
  if (!Number.isFinite(mid)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  const db = getDb()

  const recordCount = (db.prepare(
    "SELECT COUNT(*) as count FROM medication_records WHERE medication_id = ?",
  ).get(mid) as { count: number }).count
  const assignmentCount = (db.prepare(
    "SELECT COUNT(*) as count FROM person_medications WHERE medication_id = ?",
  ).get(mid) as { count: number }).count

  if (recordCount > 0 || assignmentCount > 0) {
    const reasons: string[] = []
    if (recordCount > 0) reasons.push("dose_history")
    if (assignmentCount > 0) reasons.push("person_assignment")
    db.prepare("UPDATE medications SET is_active = 0 WHERE id = ?").run(mid)
    auditLog(db, session.user?.email, "UPDATE", "medications", mid, {
      action: "deactivate_on_delete_attempt",
      reasons,
      recordCount,
      assignmentCount,
    })
    return NextResponse.json({ ok: true, action: "deactivated" as const })
  }

  const runDelete = () => {
    db.prepare("DELETE FROM medication_group_members WHERE medication_id = ?").run(mid)
    db.prepare("DELETE FROM medication_frequency_rules WHERE medication_id = ?").run(mid)
    db.prepare("DELETE FROM medications WHERE id = ?").run(mid)
  }
  db.transaction(runDelete)()
  auditLog(db, session.user?.email, "DELETE", "medications", mid)
  return NextResponse.json({ ok: true, action: "deleted" as const })
}
