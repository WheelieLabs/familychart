// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireManage } from "@/lib/auth/auth-helpers"
import { rejectDemoProfanity } from "@/lib/demo/demo-profanity-guard"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import type { MedicationGroup } from "@/lib/domain-types"

export async function GET(_request: NextRequest) {
  const authResult = await requireManage()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult

  const rows = getDb().prepare(`
    SELECT mg.*, COUNT(mgm.medication_id) as medication_count
    FROM medication_groups mg
    LEFT JOIN medication_group_members mgm ON mgm.group_id = mg.id
    LEFT JOIN medications m ON m.id = mgm.medication_id AND m.is_active = 1
    WHERE mg.is_active = 1
    GROUP BY mg.id
    ORDER BY mg.name
  `).all()

  return NextResponse.json(rows)
}

export async function POST(request: NextRequest) {
  const authResult = await requireManage()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult

  const body = await request.json()
  const { name, notes } = body
  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 })
  const profanity = await rejectDemoProfanity(name, notes)
  if (profanity) return profanity

  const db = getDb()
  const existing = db.prepare(
    "SELECT * FROM medication_groups WHERE name = ? COLLATE NOCASE AND is_active = 1"
  ).get(name.trim()) as MedicationGroup | undefined
  if (existing) return NextResponse.json(existing)

  const result = db.prepare(
    "INSERT INTO medication_groups (name, notes) VALUES (?, ?)"
  ).run(name.trim(), notes ?? null)
  auditLog(db, session.user?.email, "CREATE", "medication_groups", Number(result.lastInsertRowid), { name })
  return NextResponse.json(
    db.prepare("SELECT * FROM medication_groups WHERE id = ?").get(result.lastInsertRowid),
    { status: 201 }
  )
}
