// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireWrite } from "@/lib/auth/auth-helpers"
import { canonicalAccountUid } from "@/lib/account/account-identity"
import { rejectDemoProfanity } from "@/lib/demo/demo-profanity-guard"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import type { Favourite } from "@/lib/domain-types"

interface Params {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const authResult = await requireWrite()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const userUid = canonicalAccountUid(session)
  const { id } = await params
  const rowId = parseInt(id, 10)
  if (!Number.isFinite(rowId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }

  const db = getDb()
  const existing = db
    .prepare("SELECT * FROM favourites WHERE id = ? AND user_uid = ?")
    .get(rowId, userUid) as Favourite | undefined
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const updates: string[] = []
  const values: unknown[] = []

  if ("label" in body) {
    const v = body.label
    updates.push("label = ?")
    values.push(typeof v === "string" && v.trim() !== "" ? v.trim() : null)
  }
  if ("default_value" in body) {
    const v = body.default_value
    updates.push("default_value = ?")
    values.push(typeof v === "string" && v.trim() !== "" ? v.trim() : null)
  }
  if ("sort_order" in body) {
    const v = body.sort_order
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return NextResponse.json({ error: "sort_order must be an integer" }, { status: 400 })
    }
    updates.push("sort_order = ?")
    values.push(Math.trunc(v))
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No mutable fields provided" }, { status: 400 })
  }

  const profanity = await rejectDemoProfanity(
    "label" in body ? (typeof body.label === "string" ? body.label : null) : null,
    "default_value" in body ? (typeof body.default_value === "string" ? body.default_value : null) : null,
  )
  if (profanity) return profanity

  values.push(rowId, userUid)
  db.prepare(`UPDATE favourites SET ${updates.join(", ")} WHERE id = ? AND user_uid = ?`).run(...values)

  auditLog(db, session.user?.email, "UPDATE", "favourites", rowId, body)

  const updated = db
    .prepare("SELECT * FROM favourites WHERE id = ?")
    .get(rowId) as Favourite
  return NextResponse.json(updated)
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const authResult = await requireWrite()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const userUid = canonicalAccountUid(session)
  const { id } = await params
  const rowId = parseInt(id, 10)
  if (!Number.isFinite(rowId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }

  const db = getDb()
  const result = db
    .prepare("DELETE FROM favourites WHERE id = ? AND user_uid = ?")
    .run(rowId, userUid)

  if (result.changes === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  auditLog(db, session.user?.email, "DELETE", "favourites", rowId, {})

  return new NextResponse(null, { status: 204 })
}
