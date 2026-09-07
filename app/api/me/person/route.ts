// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/auth-helpers"
import { isDemoModeActive } from "@/lib/demo/demo-mode"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { Person } from "@/lib/domain-types"
import { canWriteForPerson } from "@/lib/permissions"
import { sessionAccountUids } from "@/lib/account/account-identity"
import { validatePersonPhotoUrlWrite } from "@/lib/person/person-photo-url"
import { deleteSupersededPersonPhoto } from "@/lib/person/person-photo-file"

function trimOrNull(s: string | undefined | null): string | null {
  if (s === undefined || s === null) return null
  const t = s.trim()
  return t === "" ? null : t
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult
  if (isDemoModeActive())
    return NextResponse.json({ error: "This is a demo environment — account changes are disabled." }, { status: 403 })

  const db      = getDb()
  const linkIds = sessionAccountUids(session.user)
  if (linkIds.length === 0) {
    return NextResponse.json({ error: "No profile linked to this account" }, { status: 404 })
  }

  const person = db
    .prepare(
      `SELECT * FROM people WHERE is_active = 1 AND account_uid IN (${linkIds.map(() => "?").join(",")})`
    )
    .get(...linkIds) as Person | undefined

  if (!person) {
    return NextResponse.json({ error: "No profile linked to this account" }, { status: 404 })
  }

  if (!canWriteForPerson(groups, session.user, person.account_uid)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let body: {
    name?: string
    display_name?: string
    full_name?: string | null
    photo_url?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const displayRaw = body.display_name ?? body.name
  const display    = typeof displayRaw === "string" ? displayRaw.trim() : ""
  if (!display) {
    return NextResponse.json({ error: "Display name is required" }, { status: 400 })
  }

  const fullName = body.full_name !== undefined ? trimOrNull(body.full_name) : person.full_name
  let photoUrl = person.photo_url
  if (body.photo_url !== undefined) {
    const raw =
      body.photo_url === null ? null : String(body.photo_url).trim() || null
    const validated = validatePersonPhotoUrlWrite(db, raw, person.id)
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }
    photoUrl = validated.photoUrl
  }

  db.prepare(
    `UPDATE people SET name = ?, full_name = ?, photo_url = ? WHERE id = ?`
  ).run(display, fullName, photoUrl, person.id)

  if (body.photo_url !== undefined) {
    await deleteSupersededPersonPhoto(db, person.photo_url, photoUrl)
  }

  auditLog(db, session.user?.email, "UPDATE", "people", person.id, {
    name: display,
    full_name: fullName,
    photo_url: photoUrl,
    source: "profile",
  })

  const updated = db.prepare("SELECT * FROM people WHERE id = ?").get(person.id) as Person
  return NextResponse.json(updated)
}
