// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { authorisePersonExport, requireAuth } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { buildPersonExport } from "@/lib/person/person-export"
import { streamExportZip } from "@/lib/export/export-zip-stream"
import { beginExport } from "@/lib/export/export-registry"
import { isExportPassphrase, normaliseExportPassphrase } from "@/lib/export/export-passphrase"
import { streamProtectedExportZip } from "@/lib/export/protected-zip"
import { actorRoleForLog, exportActivityCounts, logDataEvent } from "@/lib/data-event-log"
import { auditLog } from "@/lib/audit-log"

interface Params { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: Params) {
  return exportPerson(request, ctx, null)
}

export async function POST(request: NextRequest, ctx: Params) {
  const passphrase = await passphraseFrom(request)
  if (passphrase instanceof NextResponse) return passphrase
  return exportPerson(request, ctx, passphrase)
}

async function passphraseFrom(request: NextRequest): Promise<string | NextResponse> {
  try {
    const body = await request.json() as { passphrase?: unknown }
    const passphrase = typeof body?.passphrase === "string" ? normaliseExportPassphrase(body.passphrase) : ""
    if (!isExportPassphrase(passphrase)) {
      return NextResponse.json({ error: "Export failed" }, { status: 400 })
    }
    return passphrase
  } catch {
    return NextResponse.json({ error: "Export failed" }, { status: 400 })
  }
}

async function exportPerson(_request: NextRequest, { params }: Params, passphrase: string | null) {
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
  const protectedExport = passphrase !== null
  try {
    const built = await buildPersonExport(db, personId, new Date())
    if (!built) return NextResponse.json({ error: "Not found" }, { status: 404 })
    auditLog(db, ctx.session.user.email, "EXPORT", "people", person.id, {
      scope: built.manifest.scope,
      format_version: built.manifest.format_version,
      counts: built.manifest.counts,
      ...(protectedExport ? { protected: true } : {}),
    })
    logDataEvent({
      event: "person_export",
      outcome: "exported",
      actorRole: actorRoleForLog(ctx.groups),
      protected: protectedExport,
      counts: exportActivityCounts(built.manifest.counts),
    })

    const safeName = built.person.name.replace(/[^a-zA-Z0-9-_]+/g, "_")
    const release = beginExport([person.id])
    const body = protectedExport && passphrase
      ? streamProtectedExportZip(built.entries, passphrase, { onClose: release })
      : streamExportZip(built.entries, { onClose: release })
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeName}-export.zip"`,
      },
    })
  } catch {
    logDataEvent({
      event: "person_export",
      outcome: "failed",
      actorRole: actorRoleForLog(ctx.groups),
      protected: protectedExport,
      counts: { persons: 0, records: 0, attachments: 0 },
    })
    return NextResponse.json({ error: "Export failed" }, { status: 500 })
  }
}
