// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import {
  purgeOrphanAttachmentFiles,
  purgeOrphanUploadFiles,
  scanHouseholdUploadFiles,
  scanTestResultAttachments,
} from "@/lib/household-files"

/** `?kind=attachments` selects test-result attachments; the default stays person photos. */
export async function GET(request: NextRequest) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  const attachments = new URL(request.url).searchParams.get("kind") === "attachments"
  try {
    const scan = attachments
      ? await scanTestResultAttachments(getDb())
      : await scanHouseholdUploadFiles(getDb())
    return NextResponse.json(scan)
  } catch {
    return NextResponse.json({ error: "Failed to scan files" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  let body: { filenames?: unknown; purgeAllOrphans?: unknown; kind?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const db = getDb()
  const attachments = body.kind === "attachments"
  let filenames: string[]

  if (body.purgeAllOrphans === true) {
    const scan = attachments ? await scanTestResultAttachments(db) : await scanHouseholdUploadFiles(db)
    filenames = scan.files.filter(f => f.orphan).map(f => f.filename)
  } else if (Array.isArray(body.filenames)) {
    filenames = body.filenames.filter((f): f is string => typeof f === "string")
  } else {
    return NextResponse.json(
      { error: "Provide filenames[] or purgeAllOrphans: true" },
      { status: 400 },
    )
  }

  if (filenames.length === 0) {
    return NextResponse.json({ deleted: [], skipped: [] })
  }

  const result = attachments
    ? await purgeOrphanAttachmentFiles(db, filenames)
    : await purgeOrphanUploadFiles(db, filenames)
  auditLog(db, session.user?.email, "DELETE", "uploads", null, {
    kind: attachments ? "attachments" : "photos",
    deleted: result.deleted,
    skipped: result.skipped,
  })
  return NextResponse.json(result)
}
