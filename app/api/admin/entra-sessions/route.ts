// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { listAuthRevalidationStatuses } from "@/lib/auth/auth-revalidation"
import { isOutboundEmailConfigured } from "@/lib/email-send"
import { getEntraRevalidationGap } from "@/lib/auth/entra-revalidation-gap"

export async function GET() {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult

  const db = getDb()
  const rows = listAuthRevalidationStatuses(db, "entra")
  return NextResponse.json({
    sessions: rows,
    revalidationGap: getEntraRevalidationGap(db, Date.now()),
    outboundEmailConfigured: isOutboundEmailConfigured(db),
  })
}
