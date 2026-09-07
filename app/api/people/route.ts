// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireManage, requireRead } from "@/lib/auth/auth-helpers"
import { rejectDemoProfanity } from "@/lib/demo/demo-profanity-guard"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import type { Person } from "@/lib/domain-types"
import { canManage, canReadForPerson } from "@/lib/permissions"
import {
  findPersonAccountUidConflict,
  isPeopleAccountUidConstraintError,
  normalizePersonAccountUid,
  ACCOUNT_UID_ALREADY_LINKED_ERROR,
} from "@/lib/people-user-uid"
import { isDeadInviteAccountUid, DEAD_INVITE_LINK_ERROR } from "@/lib/invite"
import { validatePersonPhotoUrlWrite } from "@/lib/person/person-photo-url"

export async function GET() {
  const authResult = await requireRead()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult
  const rows = getDb().prepare("SELECT * FROM people WHERE is_active = 1 ORDER BY sort_order, name").all() as Person[]
  if (!canManage(groups)) {
    return NextResponse.json(rows.filter(p => canReadForPerson(groups, session.user, p.account_uid)))
  }
  return NextResponse.json(rows)
}

export async function POST(request: NextRequest) {
  const authResult = await requireManage()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult
  const body = await request.json()
  const { name, full_name, photo_url, color, sort_order, account_uid, date_of_birth } = body
  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 })
  const profanity = await rejectDemoProfanity(
    name,
    full_name,
    photo_url,
    color,
  )
  if (profanity) return profanity
  const db = getDb()
  const nextUid = normalizePersonAccountUid(account_uid)
  if (findPersonAccountUidConflict(db, nextUid)) {
    return NextResponse.json({ error: ACCOUNT_UID_ALREADY_LINKED_ERROR }, { status: 409 })
  }
  if (isDeadInviteAccountUid(db, nextUid)) {
    return NextResponse.json({ error: DEAD_INVITE_LINK_ERROR }, { status: 409 })
  }
  const rawPhoto =
    photo_url == null || photo_url === "" ? null : String(photo_url)
  // personId 0 — no existing row; uniqueness checked against every person.
  const photoValidated = validatePersonPhotoUrlWrite(db, rawPhoto, 0)
  if (!photoValidated.ok) {
    return NextResponse.json({ error: photoValidated.error }, { status: 400 })
  }
  const fn = full_name != null && String(full_name).trim() !== "" ? String(full_name).trim() : name.trim()
  try {
    const result = db.prepare(
      `INSERT INTO people (name, full_name, photo_url, color, sort_order, account_uid, date_of_birth)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(name.trim(), fn, photoValidated.photoUrl, color ?? "#256AA5", sort_order ?? 0,
          nextUid, date_of_birth ?? null)
    auditLog(db, session.user?.email, "CREATE", "people", Number(result.lastInsertRowid), { name })
    return NextResponse.json(db.prepare("SELECT * FROM people WHERE id = ?").get(result.lastInsertRowid), { status: 201 })
  } catch (err) {
    if (isPeopleAccountUidConstraintError(err)) {
      return NextResponse.json({ error: ACCOUNT_UID_ALREADY_LINKED_ERROR }, { status: 409 })
    }
    throw err
  }
}
