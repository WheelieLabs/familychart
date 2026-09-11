// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireManage, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { rejectDemoProfanity } from "@/lib/demo/demo-profanity-guard"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { ensureActivePersonMedicationLink } from "@/lib/person/person-medication-assign"
import type { Medication } from "@/lib/domain-types"

interface Params { params: Promise<{ id: string }> }

interface MedicationRecordRow {
  id: number
  person_id: number
  medication_id: number
  dosage: number | null
  dosage_unit: string | null
}

/**
 * Manager-only quick action from the post-save dose-unit-mismatch notice: creates a new
 * catalogue medication ("variant") prefilled from the original plus the recorded unit, and
 * re-homes *this one* medication_records row onto it. Does not touch history for any other
 * record, does not copy frequency rules or schedule (a tabs cap must not become an
 * applications cap), and never invents a group: the variant joins whatever
 * groups the original belongs to, or stays ungrouped if the original is ungrouped.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const authResult = await requireManage()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const { id } = await params
  const recordId = parseInt(id, 10)
  if (!Number.isFinite(recordId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }

  const body = await request.json()
  const name = typeof body.name === "string" ? body.name.trim() : ""
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 })
  const profanity = await rejectDemoProfanity(name)
  if (profanity) return profanity

  const db = getDb()

  const record = db
    .prepare("SELECT id, person_id, medication_id, dosage, dosage_unit FROM medication_records WHERE id = ?")
    .get(recordId) as MedicationRecordRow | undefined
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const person = authorisePersonAccess(db, authResult, record.person_id, "write")
  if (person instanceof NextResponse) return person

  const original = db
    .prepare("SELECT * FROM medications WHERE id = ?")
    .get(record.medication_id) as Medication | undefined
  if (!original) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (!record.dosage_unit) {
    // Nothing to re-home onto — this route only makes sense for a mismatch-flagged record.
    return NextResponse.json({ error: "This record has no recorded unit to create a variant from" }, { status: 400 })
  }

  const dup = db.prepare("SELECT id FROM medications WHERE name = ? COLLATE NOCASE").get(name) as { id: number } | undefined
  if (dup) {
    return NextResponse.json({ error: `A medication named "${name}" already exists — choose a different name` }, { status: 409 })
  }

  const originalGroupIds = (
    db.prepare("SELECT group_id FROM medication_group_members WHERE medication_id = ?").all(original.id) as {
      group_id: number
    }[]
  ).map(r => r.group_id)

  const actorEmail = session.user?.email

  const create = db.transaction((): Medication => {
    const result = db
      .prepare(
        "INSERT INTO medications (name, default_dosage, dosage_unit, notes, min_age_years, max_age_years) VALUES (?, ?, ?, NULL, ?, ?)",
      )
      .run(name, record.dosage, record.dosage_unit, original.min_age_years, original.max_age_years)
    const newId = Number(result.lastInsertRowid)

    const insertMember = db.prepare(
      "INSERT OR IGNORE INTO medication_group_members (medication_id, group_id) VALUES (?, ?)",
    )
    for (const groupId of originalGroupIds) insertMember.run(newId, groupId)

    // Re-home this save only — no schedule/frequency-rule copy. History for every other
    // record on the original medication is untouched.
    db.prepare("UPDATE medication_records SET medication_id = ? WHERE id = ?").run(newId, record.id)

    ensureActivePersonMedicationLink(db, record.person_id, newId, actorEmail, "record_dose")

    auditLog(db, actorEmail, "CREATE", "medications", newId, {
      name,
      created_as_variant_of: original.id,
      dosage_unit: record.dosage_unit,
    })
    auditLog(db, actorEmail, "UPDATE", "medication_records", record.id, {
      re_homed_from_medication_id: original.id,
      re_homed_to_medication_id: newId,
    })

    return db.prepare("SELECT * FROM medications WHERE id = ?").get(newId) as Medication
  })

  const created = create()
  return NextResponse.json(created, { status: 201 })
}
