// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { isDemoModeActive } from "@/lib/demo/demo-mode"
import { actorRoleForLog } from "@/lib/data-event-log"
import { applyStagedRestore } from "@/lib/restore/apply"
import { DEMO_RESTORE_DISABLED } from "@/lib/restore/messages"
import { RestoreError, type RestoreDecisions } from "@/lib/restore/restore-engine"
import { openStaged, StageError } from "@/lib/restore/stage-store"
import { publicOrigin } from "@/lib/reverse-proxy"

export const dynamic = "force-dynamic"

interface Params { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  if (isDemoModeActive()) {
    return NextResponse.json({ error: DEMO_RESTORE_DISABLED }, { status: 403 })
  }
  const { id } = await params
  let decisions: RestoreDecisions
  try {
    decisions = await request.json() as RestoreDecisions
  } catch {
    return NextResponse.json({ error: "Choose what to do with each Person" }, { status: 400 })
  }
  try {
    const staged = openStaged(id)
    const result = await applyStagedRestore(
      getDb(),
      staged,
      decisions,
      authResult.session.user.email ?? null,
      actorRoleForLog(authResult.groups),
      authResult.session.user,
      publicOrigin(request.headers, request.nextUrl.origin),
    )
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof StageError || err instanceof RestoreError) {
      return NextResponse.json({ error: err.message, ...err instanceof RestoreError ? err.extra : {} }, { status: err.status })
    }
    throw err
  }
}
