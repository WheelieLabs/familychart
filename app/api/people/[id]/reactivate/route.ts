// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireManage } from "@/lib/auth/auth-helpers"
import { auditLog } from "@/lib/audit-log"
import { getDb } from "@/lib/db"

interface Params { params: Promise<{ id: string }> }

/** Puts a deactivated Person back on the family list. Manager and above. */
export async function POST(_req: NextRequest, { params }: Params) {
  const authResult = await requireManage()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult
  const { id } = await params
  const personId = parseInt(id, 10)
  if (!Number.isFinite(personId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }

  const db = getDb()
  const person = db.prepare("SELECT id, is_active FROM people WHERE id = ?").get(personId) as
    { id: number; is_active: number } | undefined
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (person.is_active) {
    return NextResponse.json({ error: "This person is already on the family list" }, { status: 409 })
  }

  db.prepare("UPDATE people SET is_active = 1 WHERE id = ?").run(personId)
  auditLog(db, session.user?.email, "UPDATE", "people", personId, { event: "Person reactivated" })
  return NextResponse.json(db.prepare("SELECT * FROM people WHERE id = ?").get(personId))
}
