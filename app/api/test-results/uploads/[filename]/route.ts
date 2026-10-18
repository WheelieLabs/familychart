// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { canReadForPerson } from "@/lib/permissions"
import { logger } from "@/lib/logger"
import { InvalidUploadFilenameError, readUpload } from "@/lib/uploads/store"

const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg", jpeg: "image/jpeg",
  png: "image/png", webp: "image/webp",
}

interface Params { params: Promise<{ filename: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult
  const { filename } = await params

  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  const mimeType = MIME_TYPES[ext]
  if (!mimeType) return NextResponse.json({ error: "Unsupported type" }, { status: 400 })

  const attachmentUrl = `/api/test-results/uploads/${filename}`
  // Require canReadForPerson on *every* person row sharing this attachment_url (not just
  // .get()'s first row) so a duplicate URL cannot bypass ACL — same defence as photo serving.
  const owners = getDb()
    .prepare(
      `SELECT p.id, p.account_uid FROM test_events te
         JOIN people p ON p.id = te.person_id
        WHERE te.attachment_url = ?`,
    )
    .all(attachmentUrl) as { id: number; account_uid: string | null }[]

  if (
    owners.length === 0 ||
    owners.some(owner => !canReadForPerson(groups, session.user, owner.account_uid))
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  try {
    const buffer = await readUpload("test-results", filename)
    if (!buffer) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (err) {
    if (err instanceof InvalidUploadFilenameError) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 })
    }
    logger.error(`Test result upload read failed for ${filename}:`, err)
    return NextResponse.json({ error: "Upload read failed" }, { status: 500 })
  }
}
