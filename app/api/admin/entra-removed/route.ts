// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { allowEntraPersonBack, listRemovedEntraAccounts } from "@/lib/account/entra-removed"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { auditLog } from "@/lib/audit-log"
import { getDb } from "@/lib/db"

/** Tombstones an Admin can clear. The hash is the identifier; the page shows the removal time only. */
export async function GET() {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  return NextResponse.json({ accounts: listRemovedEntraAccounts(getDb()) })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  let body: { id?: unknown } = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const id = typeof body.id === "string" ? body.id : ""
  if (!/^[a-f0-9]{64}$/.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const db = getDb()
  if (!allowEntraPersonBack(db, id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  auditLog(db, authResult.session.user.email, "DELETE", "entra_removed_accounts", null, {
    event: "Allow this person back",
  })
  return NextResponse.json({ allowed: true })
}
