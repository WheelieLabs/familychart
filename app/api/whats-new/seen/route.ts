// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import { requireRead } from "@/lib/auth/auth-helpers"
import { canonicalAccountUid } from "@/lib/account/account-identity"
import { getDb } from "@/lib/db"
import { APP_VERSION } from "@/lib/version"

export async function POST() {
  const authResult = await requireRead()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const userUid = canonicalAccountUid(session)
  if (!userUid) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const db = getDb()
  db.prepare(
    `INSERT INTO user_app_state (user_uid, last_seen_version, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_uid) DO UPDATE
       SET last_seen_version = excluded.last_seen_version,
           updated_at        = excluded.updated_at`
  ).run(userUid, APP_VERSION)

  return NextResponse.json({ ok: true })
}
