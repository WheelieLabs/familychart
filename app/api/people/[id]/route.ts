// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireManage, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { rejectDemoProfanity } from "@/lib/demo/demo-profanity-guard"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import type { Person } from "@/lib/domain-types"
import {
  findPersonAccountUidConflict,
  isPeopleAccountUidConstraintError,
  normalizePersonAccountUid,
  ACCOUNT_UID_ALREADY_LINKED_ERROR,
} from "@/lib/people-user-uid"
import { isDeadInviteAccountUid, DEAD_INVITE_LINK_ERROR } from "@/lib/invite"
import { validatePersonPhotoUrlWrite } from "@/lib/person/person-photo-url"
import { deleteSupersededPersonPhoto } from "@/lib/person/person-photo-file"

interface Params { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { id } = await params
  const db = getDb()
  const person = authorisePersonAccess(db, authResult, parseInt(id, 10), "read")
  if (person instanceof NextResponse) return person
  return NextResponse.json(person)
}

export async function PUT(request: NextRequest, { params }: Params) {
  const authResult = await requireManage()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult
  const { id } = await params
  const pid  = parseInt(id, 10)
  const body = await request.json()
  const { name, full_name, photo_url, color, sort_order, account_uid, date_of_birth } = body
  const db = getDb()
  const existing = db
    .prepare("SELECT * FROM people WHERE id = ? AND is_active = 1")
    .get(pid) as Person | undefined
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const profanity = await rejectDemoProfanity(name, full_name, photo_url, color)
  if (profanity) return profanity

  const nextName = name !== undefined ? name : existing.name
  const nextFull =
    full_name !== undefined
      ? (full_name === null || full_name === "" ? null : String(full_name))
      : existing.full_name
  let nextPhoto = existing.photo_url
  if (photo_url !== undefined) {
    const raw = photo_url === null || photo_url === "" ? null : String(photo_url)
    const validated = validatePersonPhotoUrlWrite(db, raw, pid)
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }
    nextPhoto = validated.photoUrl
  }
  const nextColor  = color !== undefined ? color : existing.color
  const nextSort   = sort_order !== undefined ? sort_order : existing.sort_order
  const nextUid =
    account_uid !== undefined ? normalizePersonAccountUid(account_uid) : existing.account_uid
  const nextDob    = date_of_birth !== undefined ? date_of_birth || null : existing.date_of_birth

  if (findPersonAccountUidConflict(db, nextUid, pid)) {
    return NextResponse.json({ error: ACCOUNT_UID_ALREADY_LINKED_ERROR }, { status: 409 })
  }
  // Only reject a *new* assignment to a dead invite — a Person already linked to one keeps
  // that link untouched on an unrelated save (see the invite lifecycle's "left exactly as-is"
  // rule); this just stops a dead invite from being newly offered as a link target.
  if (nextUid !== existing.account_uid && isDeadInviteAccountUid(db, nextUid)) {
    return NextResponse.json({ error: DEAD_INVITE_LINK_ERROR }, { status: 409 })
  }

  try {
    db.prepare(
      `UPDATE people SET name=?, full_name=?, photo_url=?, color=?, sort_order=?, account_uid=?, date_of_birth=?
       WHERE id=?`
    ).run(nextName, nextFull, nextPhoto, nextColor, nextSort, nextUid, nextDob, pid)
  } catch (err) {
    if (isPeopleAccountUidConstraintError(err)) {
      return NextResponse.json({ error: ACCOUNT_UID_ALREADY_LINKED_ERROR }, { status: 409 })
    }
    throw err
  }
  if (photo_url !== undefined) {
    await deleteSupersededPersonPhoto(db, existing.photo_url, nextPhoto)
  }
  auditLog(db, session.user?.email, "UPDATE", "people", pid, body)
  return NextResponse.json(db.prepare("SELECT * FROM people WHERE id = ?").get(pid))
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const authResult = await requireManage()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult
  const { id } = await params
  const db = getDb()
  db.prepare("UPDATE people SET is_active = 0 WHERE id = ?").run(parseInt(id, 10))
  auditLog(db, session.user?.email, "DELETE", "people", parseInt(id, 10))
  return NextResponse.json({ success: true })
}
