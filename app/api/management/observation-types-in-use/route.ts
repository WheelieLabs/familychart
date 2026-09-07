// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import { requireManage } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"

/** Distinct observation_type values in observations or reminder schedules — for locking type names & delete UX. */
export async function GET() {
  const authResult = await requireManage()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult

  const db = getDb()
  const obs = db
    .prepare("SELECT DISTINCT observation_type FROM observations ORDER BY observation_type")
    .all() as { observation_type: string }[]
  const exp = db
    .prepare(
      "SELECT DISTINCT observation_type FROM person_observation_expectations ORDER BY observation_type",
    )
    .all() as { observation_type: string }[]

  const uniq = new Set<string>()
  for (const r of obs) {
    if (r.observation_type?.trim()) uniq.add(r.observation_type.trim())
  }
  for (const r of exp) {
    if (r.observation_type?.trim()) uniq.add(r.observation_type.trim())
  }
  return NextResponse.json([...uniq].sort())
}
