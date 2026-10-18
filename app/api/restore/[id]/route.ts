// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { isDemoModeActive } from "@/lib/demo/demo-mode"
import { DEMO_RESTORE_DISABLED } from "@/lib/restore/messages"
import { buildPlan, RestoreError } from "@/lib/restore/restore-engine"
import { openStaged, StageError } from "@/lib/restore/stage-store"

export const dynamic = "force-dynamic"

interface Params { params: Promise<{ id: string }> }

/** Read-only preview of a staged export. */
export async function GET(_request: NextRequest, { params }: Params) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  if (isDemoModeActive()) {
    return NextResponse.json({ error: DEMO_RESTORE_DISABLED }, { status: 403 })
  }
  const { id } = await params
  try {
    const staged = openStaged(id)
    const plan = buildPlan(getDb(), staged)
    const { file_jobs: _fileJobs, ...body } = plan
    return NextResponse.json(body)
  } catch (err) {
    if (err instanceof StageError || err instanceof RestoreError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }
}
