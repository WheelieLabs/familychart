// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireManage } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import type { FrequencyRule } from "@/lib/domain-types"
import { parseMinHoursBetweenFromApi } from "@/lib/frequency-rule"

interface Params { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: Params) {
  const authResult = await requireManage()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult
  const { id } = await params
  const db = getDb()
  const mid = parseInt(id, 10)

  const rules = db.prepare(
    `SELECT * FROM medication_frequency_rules WHERE medication_id = ?
     ORDER BY COALESCE(min_age_years, -1), min_hours_between`
  ).all(mid) as FrequencyRule[]

  return NextResponse.json({ rules })
}

export async function POST(request: NextRequest, { params }: Params) {
  const authResult = await requireManage()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult
  const { id } = await params
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
  if (!minParsed.ok) return NextResponse.json({ error: minParsed.message }, { status: 400 })
  const db = getDb()
  const med = db.prepare("SELECT dosage_unit FROM medications WHERE id = ?").get(parseInt(id, 10)) as
    { dosage_unit: string } | undefined
  const countDoses = !!max_per_24h_count_doses
  const max_quantity_unit =
    max_quantity_per_24h != null && med && !countDoses ? med.dosage_unit : null
  const per24hFlag = countDoses ? 1 : 0

  const result = db.prepare(
    `INSERT INTO medication_frequency_rules
     (medication_id, min_hours_between, max_hours_between,
      max_quantity_per_24h, max_quantity_unit, max_per_24h_count_doses,
      min_age_years, max_age_years, dosage,
      min_weight_kg, max_weight_kg)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    parseInt(id, 10), minParsed.value,
    max_hours_between    ?? null,
    max_quantity_per_24h ?? null, max_quantity_unit, per24hFlag,
    min_age_years ?? null, max_age_years ?? null,
    dosage ?? null,
    min_weight_kg ?? null, max_weight_kg ?? null,
  )
  auditLog(db, session.user?.email, "CREATE", "medication_frequency_rules",
    Number(result.lastInsertRowid), { medication_id: id })
  return NextResponse.json(
    db.prepare("SELECT * FROM medication_frequency_rules WHERE id = ?")
      .get(result.lastInsertRowid) as FrequencyRule,
    { status: 201 }
  )
}
