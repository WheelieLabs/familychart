// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { loadAccessControlMemberships } from "@/lib/entra-group-members"

export async function GET() {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult

  const result = await loadAccessControlMemberships()
  return NextResponse.json(result)
}
