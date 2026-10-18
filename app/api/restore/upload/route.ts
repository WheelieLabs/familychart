// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { isDemoModeActive } from "@/lib/demo/demo-mode"
import { DEMO_RESTORE_DISABLED } from "@/lib/restore/messages"
import { StageError, stageUpload } from "@/lib/restore/stage-store"

export const dynamic = "force-dynamic"

/**
 * Staged restore upload. Kept out of the auth proxy matcher so the proxy does not buffer the
 * body; this handler checks the admin session itself and copies the zip to a temporary file.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  if (isDemoModeActive()) {
    return NextResponse.json({ error: DEMO_RESTORE_DISABLED }, { status: 403 })
  }
  try {
    const staged = await stageUpload(request.body)
    return NextResponse.json({
      id: staged.id,
      format_version: staged.manifest.format_version,
      scope: staged.manifest.scope,
      app_version: staged.manifest.app_version,
      exported_at: staged.manifest.exported_at,
      sections: staged.manifest.sections,
      counts: staged.manifest.counts,
      skipped_files: staged.manifest.skipped_files,
      ...(staged.manifest.protected ? { protected: true } : {}),
    })
  } catch (err) {
    if (err instanceof StageError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }
}
