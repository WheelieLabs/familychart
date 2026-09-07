// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { listAuthRevalidationStatuses } from "@/lib/auth/auth-revalidation"

export async function GET() {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult

  const rows = listAuthRevalidationStatuses(getDb(), "entra")
  return NextResponse.json({ sessions: rows })
}
