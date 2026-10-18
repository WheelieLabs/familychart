// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { estimateHouseholdExportSize } from "@/lib/export/household-export"
import { logger } from "@/lib/logger"

export async function GET() {
  const ctx = await requireAdmin()
  if (ctx instanceof NextResponse) return ctx
  try {
    return NextResponse.json(await estimateHouseholdExportSize(getDb()))
  } catch (err) {
    logger.error("Household export size estimate failed:", err)
    return NextResponse.json({ error: "Export failed" }, { status: 500 })
  }
}
