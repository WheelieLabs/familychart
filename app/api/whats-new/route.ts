// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import { requireRead } from "@/lib/auth/auth-helpers"
import { canonicalAccountUid } from "@/lib/account/account-identity"
import { getDb } from "@/lib/db"
import { APP_VERSION } from "@/lib/version"
import changelogData from "@/lib/changelog.generated.json"
import { filterWhatsNewEntries, type ChangelogEntry } from "@/lib/whats-new-filter"

export async function GET() {
  const authResult = await requireRead()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult

  const userUid = canonicalAccountUid(session)
  if (!userUid) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const db = getDb()

  const row = db
    .prepare("SELECT last_seen_version FROM user_app_state WHERE user_uid = ?")
    .get(userUid) as { last_seen_version: string | null } | undefined

  if (!row) {
    db.prepare(
      `INSERT INTO user_app_state (user_uid, last_seen_version, updated_at)
       VALUES (?, ?, datetime('now'))`
    ).run(userUid, APP_VERSION)
    return NextResponse.json({ entries: [] })
  }

  const lastSeen = row.last_seen_version ?? "0.0.0"
  const entries = filterWhatsNewEntries(
    changelogData.entries as ChangelogEntry[],
    lastSeen,
    APP_VERSION
  )

  return NextResponse.json({ entries })
}
