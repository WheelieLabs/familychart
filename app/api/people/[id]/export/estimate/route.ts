// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { authorisePersonExport, requireAuth } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { estimatePersonExportBytes } from "@/lib/export/person-export-estimate"

interface Params { params: Promise<{ id: string }> }

/** Size of one Person export before the download starts. Same authorisation as the export itself. */
export async function GET(_request: NextRequest, { params }: Params) {
  const ctx = await requireAuth()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  const personId = parseInt(id, 10)
  if (!Number.isFinite(personId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }

  const db = getDb()
  const person = authorisePersonExport(db, ctx, personId)
  if (person instanceof NextResponse) return person
  const estimate = await estimatePersonExportBytes(db, person.id)
  if (!estimate) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ total_bytes: estimate.totalBytes, report_bytes: estimate.reportBytes })
}
