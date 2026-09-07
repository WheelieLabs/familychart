// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@/lib/logger"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { isAdmin } from "@/lib/permissions"
import { parseLocalAccountUid } from "@/lib/account/account-uid"
import { getSetupWizardContext } from "@/lib/setup-gate"

export async function GET() {
  try {
    const db = getDb()
    const session = await auth()
    const user = session?.user as
      | { id?: string | null; email?: string | null; groups?: string[]; entraOid?: string | null }
      | undefined
    const groups = user?.groups ?? []

    return NextResponse.json(
      getSetupWizardContext(db, {
        authenticated: !!session?.user,
        isAdmin: session?.user ? isAdmin(groups) : false,
        entraSession: !!user?.entraOid,
        localUserId: parseLocalAccountUid(user?.id),
        email: user?.email ?? null,
      }),
    )
  } catch (err) {
    logger.error("GET /api/setup/status failed:", err)
    return NextResponse.json({ error: "Setup status unavailable" }, { status: 503 })
  }
}
