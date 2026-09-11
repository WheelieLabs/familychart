// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { getPersonExportData, buildPersonExportZip, type PersonExportAttachment } from "@/lib/person/person-export"
import { logger } from "@/lib/logger"
import { readUpload } from "@/lib/uploads/store"

interface Params { params: Promise<{ id: string }> }

/** Person photo only for v1.0.0 — test-result-file attachments deferred to a future release. */
async function loadPersonPhoto(photoUrl: string | null): Promise<PersonExportAttachment | null> {
  if (!photoUrl) return null
  const filename = photoUrl.split("/").pop()
  if (!filename) return null
  const buffer = await readUpload("people", filename)
  if (!buffer) {
    logger.warn(`Person export: photo missing on disk for ${filename}`)
    return null
  }
  return { filename, buffer }
}

export async function GET(_request: NextRequest, { params }: Params) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  const { id } = await params
  const personId = parseInt(id, 10)
  if (!Number.isFinite(personId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }

  const db = getDb()
  const data = getPersonExportData(db, personId)
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })

  try {
    const photo = await loadPersonPhoto(data.person.photo_url)
    const zipBuffer = await buildPersonExportZip(data, photo)

    const safeName = data.person.name.replace(/[^a-zA-Z0-9-_]+/g, "_")
    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeName}-export.zip"`,
      },
    })
  } catch (err) {
    logger.error(`Person export failed for id=${personId}:`, err)
    return NextResponse.json({ error: "Export failed" }, { status: 500 })
  }
}
