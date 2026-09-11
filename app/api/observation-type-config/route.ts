// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import { requireManage, requireRead } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { listObservationTypeConfigs } from "@/lib/observation/observation-type-meta"

export async function GET() {
  const authResult = await requireRead()
  if (authResult instanceof NextResponse) return authResult

  return NextResponse.json(listObservationTypeConfigs(getDb()))
}

/**
 * Creating observation types is not supported.
 * Catalogue rows are seeded via migrations; managers may only toggle `is_active` via PATCH.
 */
export async function POST() {
  const authResult = await requireManage()
  if (authResult instanceof NextResponse) return authResult

  return NextResponse.json(
    {
      error:
        "Creating observation types is not supported. Use the curated catalogue and toggle is_active.",
    },
    { status: 405, headers: { Allow: "GET" } },
  )
}
