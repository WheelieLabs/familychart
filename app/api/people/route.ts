// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireManage, requireRead } from "@/lib/auth/auth-helpers"
import { rejectDemoProfanity } from "@/lib/demo/demo-profanity-guard"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import type { Person } from "@/lib/domain-types"
import { canManage, canReadForPerson, isAdmin } from "@/lib/permissions"
import {
  findPersonAccountUidConflict,
  isPeopleAccountUidConstraintError,
  normalizePersonAccountUid,
  ACCOUNT_UID_ALREADY_LINKED_ERROR,
  PERSON_LINK_ADMIN_ONLY_ERROR,
} from "@/lib/people-user-uid"
import { isDeadInviteAccountUid, DEAD_INVITE_LINK_ERROR } from "@/lib/invite"
import { validatePersonPhotoUrlWrite } from "@/lib/person/person-photo-url"
import { estimatePersonExportBytes } from "@/lib/export/person-export-estimate"

export async function GET(request: NextRequest) {
  const authResult = await requireRead()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult
  // The export screen is the one Admin list that still names inactive Persons.
  const includeInactive = isAdmin(groups) && new URL(request.url).searchParams.get("include_inactive") === "1"
  const rows = getDb().prepare(
    includeInactive
      ? "SELECT * FROM people ORDER BY sort_order, name"
      : "SELECT * FROM people WHERE is_active = 1 ORDER BY sort_order, name",
  ).all() as Person[]
  const visible = canManage(groups)
    ? rows
    : rows.filter(p => canReadForPerson(groups, session.user, p.account_uid))
  if (!includeInactive) return NextResponse.json(visible)
  const withSizes = []
  for (const person of visible) {
    const estimate = await estimatePersonExportBytes(getDb(), person.id)
    withSizes.push({
      ...person,
      export_total_bytes: estimate?.totalBytes ?? 0,
      export_report_bytes: estimate?.reportBytes ?? 0,
    })
  }
  return NextResponse.json(withSizes)
}

export async function POST(request: NextRequest) {
  const authResult = await requireManage()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult
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
  if (nextUid !== null && !isAdmin(groups)) {
    return NextResponse.json({ error: PERSON_LINK_ADMIN_ONLY_ERROR }, { status: 403 })
  }
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
