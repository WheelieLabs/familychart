// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { isDemoModeActive } from "@/lib/demo/demo-mode"
import { DEMO_RESTORE_DISABLED } from "@/lib/restore/messages"
import { StageError, unlockStaged } from "@/lib/restore/stage-store"

export const dynamic = "force-dynamic"

interface Params { params: Promise<{ id: string }> }

/** Checks the passphrase and, once it opens the file, returns the manifest contents. */
export async function POST(request: NextRequest, { params }: Params) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  if (isDemoModeActive()) {
    return NextResponse.json({ error: DEMO_RESTORE_DISABLED }, { status: 403 })
  }
  const { id } = await params
  let passphrase = ""
  try {
    const body = await request.json() as { passphrase?: unknown }
    if (typeof body?.passphrase === "string") passphrase = body.passphrase
  } catch {
    passphrase = ""
  }
  try {
    const staged = await unlockStaged(id, passphrase)
    return NextResponse.json({
      id: staged.id,
      protected: staged.manifest.protected === true,
      format_version: staged.manifest.format_version,
      scope: staged.manifest.scope,
      app_version: staged.manifest.app_version,
      exported_at: staged.manifest.exported_at,
      sections: staged.manifest.sections,
      counts: staged.manifest.counts,
      skipped_files: staged.manifest.skipped_files,
    })
  } catch (err) {
    if (err instanceof StageError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }
}
