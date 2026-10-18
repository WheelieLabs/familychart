// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { buildHouseholdExport } from "@/lib/export/household-export"
import { streamExportZip } from "@/lib/export/export-zip-stream"
import { beginExport } from "@/lib/export/export-registry"
import { isExportPassphrase, normaliseExportPassphrase } from "@/lib/export/export-passphrase"
import { streamProtectedExportZip } from "@/lib/export/protected-zip"
import { actorRoleForLog, exportActivityCounts, logDataEvent } from "@/lib/data-event-log"
import { auditLog } from "@/lib/audit-log"

export async function GET(_request: NextRequest) {
  return exportHousehold(null)
}

export async function POST(request: NextRequest) {
  const passphrase = await passphraseFrom(request)
  if (passphrase instanceof NextResponse) return passphrase
  return exportHousehold(passphrase)
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

async function exportHousehold(passphrase: string | null) {
  const ctx = await requireAdmin()
  if (ctx instanceof NextResponse) return ctx
  const db = getDb()
  const protectedExport = passphrase !== null
  try {
    const built = await buildHouseholdExport(db, new Date())
    auditLog(db, ctx.session.user.email, "EXPORT", "household", null, {
      scope: built.manifest.scope,
      person_count: built.personIds.length,
      format_version: built.manifest.format_version,
      counts: built.manifest.counts,
      ...(protectedExport ? { protected: true } : {}),
    })
    logDataEvent({
      event: "household_export",
      outcome: "exported",
      actorRole: actorRoleForLog(ctx.groups),
      protected: protectedExport,
      counts: exportActivityCounts(built.manifest.counts),
    })
    const release = beginExport(built.personIds)
    const body = protectedExport && passphrase
      ? streamProtectedExportZip(built.entries, passphrase, { onClose: release })
      : streamExportZip(built.entries, { onClose: release })
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="household-export.zip"',
      },
    })
  } catch {
    logDataEvent({
      event: "household_export",
      outcome: "failed",
      actorRole: actorRoleForLog(ctx.groups),
      protected: protectedExport,
      counts: { persons: 0, records: 0, attachments: 0 },
    })
    return NextResponse.json({ error: "Export failed" }, { status: 500 })
  }
}
