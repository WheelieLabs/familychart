// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { purgeOrphanUploadFiles, scanHouseholdUploadFiles } from "@/lib/household-files"

export async function GET() {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  try {
    const scan = await scanHouseholdUploadFiles(getDb())
    return NextResponse.json(scan)
  } catch {
    return NextResponse.json({ error: "Failed to scan files" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  let body: { filenames?: unknown; purgeAllOrphans?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const db = getDb()
  let filenames: string[]

  if (body.purgeAllOrphans === true) {
    const scan = await scanHouseholdUploadFiles(db)
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

  const result = await purgeOrphanUploadFiles(db, filenames)
  auditLog(db, session.user?.email, "DELETE", "uploads", null, {
    deleted: result.deleted,
    skipped: result.skipped,
  })
  return NextResponse.json(result)
}
