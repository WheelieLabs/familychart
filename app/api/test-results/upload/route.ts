// SPDX-License-Identifier: AGPL-3.0-only

import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { canWriteForPerson } from "@/lib/permissions"
import { logger } from "@/lib/logger"
import { writeUpload } from "@/lib/uploads/store"

const MAX_SIZE = 20 * 1024 * 1024
const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/webp"]
const EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (!ALLOWED.includes(file.type)) {
      return NextResponse.json({ error: "Only PDF, JPEG, PNG and WebP allowed" }, { status: 400 })
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File must be under 20MB" }, { status: 400 })
    }

    const personIdRaw = formData.get("person_id")
    const pid = personIdRaw != null ? parseInt(String(personIdRaw), 10) : NaN
    if (!Number.isFinite(pid)) {
      return NextResponse.json({ error: "person_id is required" }, { status: 400 })
    }
    const row = getDb()
      .prepare("SELECT account_uid FROM people WHERE id = ? AND is_active = 1")
      .get(pid) as { account_uid: string | null } | undefined
    if (!row || !canWriteForPerson(groups, session.user, row.account_uid)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const filename = `${randomUUID()}.${EXT[file.type]}`
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeUpload("test-results", filename, buffer)
    return NextResponse.json({ url: `/api/test-results/uploads/${filename}` }, { status: 201 })
  } catch (err) {
    logger.error("Test result upload error:", err)
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}
