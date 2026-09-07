// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireManage } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import type { FrequencyRule } from "@/lib/domain-types"
import { parseMinHoursBetweenFromApi } from "@/lib/frequency-rule"

interface Params { params: Promise<{ id: string; ruleId: string }> }

export async function PUT(request: NextRequest, { params }: Params) {
  const authResult = await requireManage()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult

  const { id: medIdStr, ruleId: ruleIdStr } = await params
  const medicationId = parseInt(medIdStr, 10)
  const ruleId = parseInt(ruleIdStr, 10)
  if (!Number.isFinite(medicationId) || !Number.isFinite(ruleId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }

  const body = await request.json()
  const {
    min_hours_between, max_hours_between,
    max_quantity_per_24h,
    max_per_24h_count_doses,
    min_age_years, max_age_years,
    min_weight_kg, max_weight_kg,
    dosage,
  } = body
  const minParsed = parseMinHoursBetweenFromApi(min_hours_between)
  if (!minParsed.ok) {
    return NextResponse.json({ error: minParsed.message }, { status: 400 })
  }

  const db = getDb()
  const row = db
    .prepare(
      "SELECT id, medication_id FROM medication_frequency_rules WHERE id = ?",
    )
    .get(ruleId) as { id: number; medication_id: number | null } | undefined
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (row.medication_id !== medicationId) {
    return NextResponse.json({ error: "Rule does not belong to this medication" }, { status: 403 })
  }

  const med = db.prepare("SELECT dosage_unit FROM medications WHERE id = ?").get(medicationId) as
    { dosage_unit: string } | undefined
  const countDoses = !!max_per_24h_count_doses
  const max_quantity_unit =
    max_quantity_per_24h != null && med && !countDoses ? med.dosage_unit : null
  const per24hFlag = countDoses ? 1 : 0

  db.prepare(
    `UPDATE medication_frequency_rules
     SET min_hours_between=?, max_hours_between=?,
         max_quantity_per_24h=?, max_quantity_unit=?, max_per_24h_count_doses=?,
         min_age_years=?, max_age_years=?, dosage=?,
         min_weight_kg=?, max_weight_kg=?
     WHERE id=? AND medication_id=?`
  ).run(
    minParsed.value,
    max_hours_between ?? null,
    max_quantity_per_24h ?? null,
    max_quantity_unit,
    per24hFlag,
    min_age_years ?? null,
    max_age_years ?? null,
    dosage ?? null,
    min_weight_kg ?? null,
    max_weight_kg ?? null,
    ruleId,
    medicationId,
  )
  auditLog(db, session.user?.email, "UPDATE", "medication_frequency_rules", ruleId, {
    medication_id: medicationId,
    ...body,
  })
  return NextResponse.json(
    db.prepare("SELECT * FROM medication_frequency_rules WHERE id = ?").get(ruleId) as FrequencyRule
  )
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const authResult = await requireManage()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult
  const { id: medIdStr, ruleId: ruleIdStr } = await params
  const medicationId = parseInt(medIdStr, 10)
  const ruleId = parseInt(ruleIdStr, 10)
  if (!Number.isFinite(medicationId) || !Number.isFinite(ruleId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }
  const db = getDb()
  const row = db
    .prepare("SELECT id, medication_id FROM medication_frequency_rules WHERE id = ?")
    .get(ruleId) as { id: number; medication_id: number | null } | undefined
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (row.medication_id !== medicationId) {
    return NextResponse.json({ error: "Rule does not belong to this medication" }, { status: 403 })
  }
  db.prepare("DELETE FROM medication_frequency_rules WHERE id = ? AND medication_id = ?").run(ruleId, medicationId)
  auditLog(db, session.user?.email, "DELETE", "medication_frequency_rules", ruleId)
  return NextResponse.json({ success: true })
}
