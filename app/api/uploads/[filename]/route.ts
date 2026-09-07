// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { canReadForPerson } from "@/lib/permissions"
import { logger } from "@/lib/logger"
import { InvalidUploadFilenameError, readUpload } from "@/lib/uploads/store"

const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg",
  png: "image/png", webp: "image/webp", gif: "image/gif",
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

  const photoUrl = `/api/uploads/${filename}`
  // Require canReadForPerson on *every* person row sharing this photo_url
  // (not just .get()'s first row) so a duplicate URL cannot bypass ACL.
  const owners = getDb()
    .prepare("SELECT id, account_uid FROM people WHERE photo_url = ?")
    .all(photoUrl) as { id: number; account_uid: string | null }[]

  // Default-deny: no owners (orphaned/replaced) or any owner the caller cannot read
  // → 404. Includes deactivated owners — is_active is intentionally not filtered.
  if (
    owners.length === 0 ||
    owners.some(owner => !canReadForPerson(groups, session.user, owner.account_uid))
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  try {
    const buffer = await readUpload("people", filename)
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
    logger.error(`Upload read failed for ${filename}:`, err)
    return NextResponse.json({ error: "Upload read failed" }, { status: 500 })
  }
}
