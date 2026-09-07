// SPDX-License-Identifier: AGPL-3.0-only

import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { canManage, canWrite, canWriteForPerson } from "@/lib/permissions"
import { logger } from "@/lib/logger"
import { writeUpload } from "@/lib/uploads/store"

const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"]

export async function POST(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (!ALLOWED.includes(file.type)) {
      return NextResponse.json({ error: "Only JPEG, PNG, WebP and GIF allowed" }, { status: 400 })
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File must be under 5MB" }, { status: 400 })
    }

    let allowed = canManage(groups) || canWrite(groups)
    if (!allowed) {
      const personIdRaw = formData.get("person_id")
      const pid = personIdRaw != null ? parseInt(String(personIdRaw), 10) : NaN
      if (Number.isFinite(pid)) {
        const row = getDb()
          .prepare("SELECT account_uid FROM people WHERE id = ? AND is_active = 1")
          .get(pid) as { account_uid: string | null } | undefined
        if (row && canWriteForPerson(groups, session.user, row.account_uid)) allowed = true
      }
    }
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const ext = file.type.split("/")[1].replace("jpeg", "jpg")
    const filename = `${randomUUID()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeUpload("people", filename, buffer)
    return NextResponse.json({ url: `/api/uploads/${filename}` }, { status: 201 })
  } catch (err) {
    logger.error("Upload error:", err)
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}
