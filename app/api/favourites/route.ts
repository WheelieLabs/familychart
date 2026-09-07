// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireRead, requireWrite } from "@/lib/auth/auth-helpers"
import { canonicalAccountUid } from "@/lib/account/account-identity"
import { rejectDemoProfanity } from "@/lib/demo/demo-profanity-guard"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import type { FavouriteResolved } from "@/lib/domain-types"

const RESOLVED_QUERY = `
  SELECT f.*,
    p.name  AS person_name,
    p.color AS person_color,
    m.name  AS medication_name
  FROM favourites f
  LEFT JOIN people      p ON p.id = f.person_id    AND p.is_active = 1
  LEFT JOIN medications m ON m.id = f.medication_id AND m.is_active = 1
`

function attachResolved(row: Record<string, unknown>): FavouriteResolved {
  const personName = (row.person_name as string | null) ?? null
  const medicationName = (row.medication_name as string | null) ?? null
  const resolved =
    personName !== null &&
    (row.action_kind === "observation" || medicationName !== null)
  return { ...(row as unknown as FavouriteResolved), resolved }
}

export async function GET() {
  const authResult = await requireRead()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const userUid = canonicalAccountUid(session)
  const db = getDb()

  const rows = db
    .prepare(
      `${RESOLVED_QUERY}
       WHERE f.user_uid = ?
       ORDER BY f.sort_order, f.created_at`
    )
    .all(userUid) as Record<string, unknown>[]

  return NextResponse.json(rows.map(attachResolved))
}

export async function POST(request: NextRequest) {
  const authResult = await requireWrite()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const userUid = canonicalAccountUid(session)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const actionKind = body.action_kind
  if (actionKind !== "medication" && actionKind !== "observation") {
    return NextResponse.json(
      { error: "action_kind must be 'medication' or 'observation'" },
      { status: 400 }
    )
  }

  const personIdRaw = body.person_id
  const personId =
    typeof personIdRaw === "number"
      ? personIdRaw
      : typeof personIdRaw === "string"
        ? parseInt(personIdRaw, 10)
        : NaN
  if (!Number.isFinite(personId)) {
    return NextResponse.json({ error: "person_id is required" }, { status: 400 })
  }

  const db = getDb()

  const person = db
    .prepare("SELECT id FROM people WHERE id = ? AND is_active = 1")
    .get(personId) as { id: number } | undefined
  if (!person) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 })
  }

  let medicationId: number | null = null
  let observationType: string | null = null

  if (actionKind === "medication") {
    if (body.observation_type != null && body.observation_type !== "") {
      return NextResponse.json(
        { error: "observation_type must not be set for medication favourites" },
        { status: 400 }
      )
    }
    const medIdRaw = body.medication_id
    medicationId =
      typeof medIdRaw === "number"
        ? medIdRaw
        : typeof medIdRaw === "string"
          ? parseInt(medIdRaw, 10)
          : NaN
    if (!Number.isFinite(medicationId)) {
      return NextResponse.json({ error: "medication_id is required for medication favourites" }, { status: 400 })
    }

    const med = db
      .prepare("SELECT id FROM medications WHERE id = ? AND is_active = 1")
      .get(medicationId) as { id: number } | undefined
    if (!med) {
      return NextResponse.json({ error: "Medication not found" }, { status: 400 })
    }
  } else {
    if (body.medication_id != null && body.medication_id !== "") {
      return NextResponse.json(
        { error: "medication_id must not be set for observation favourites" },
        { status: 400 }
      )
    }
    const obsType = body.observation_type
    if (typeof obsType !== "string" || obsType.trim() === "") {
      return NextResponse.json(
        { error: "observation_type is required for observation favourites" },
        { status: 400 }
      )
    }
    observationType = obsType.trim()

    const typeExists = db
      .prepare(
        "SELECT 1 FROM observation_type_config WHERE observation_type = ? AND is_active = 1"
      )
      .get(observationType)
    if (!typeExists) {
      return NextResponse.json({ error: "Observation type not found" }, { status: 400 })
    }
  }

  const defaultValue =
    typeof body.default_value === "string" && body.default_value.trim() !== ""
      ? body.default_value.trim()
      : null
  const label =
    typeof body.label === "string" && body.label.trim() !== ""
      ? body.label.trim()
      : null

  const profanity = await rejectDemoProfanity(label, defaultValue, observationType)
  if (profanity) return profanity

  const { nextSort } = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextSort FROM favourites WHERE user_uid = ?")
    .get(userUid) as { nextSort: number }

  const result = db
    .prepare(
      `INSERT INTO favourites
         (user_uid, person_id, action_kind, medication_id, observation_type, default_value, label, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(userUid, personId, actionKind, medicationId, observationType, defaultValue, label, nextSort)

  const newId = Number(result.lastInsertRowid)
  auditLog(db, session.user?.email, "CREATE", "favourites", newId, {
    action_kind: actionKind,
    person_id: personId,
    medication_id: medicationId,
    observation_type: observationType,
  })

  const row = db
    .prepare(`${RESOLVED_QUERY} WHERE f.id = ?`)
    .get(newId) as Record<string, unknown>

  return NextResponse.json(attachResolved(row), { status: 201 })
}
