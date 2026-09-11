// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/auth-helpers"
import {
  findPersonalLinkPerson,
  hydrationSettingsCandidateUids,
  linkedPersonAccountUid,
} from "@/lib/account/account-identity"
import { getDb } from "@/lib/db"
import {
  getHydrationConfig,
  getHydrationConfigForUserUids,
  patchBodyToPartial,
  setHydrationConfig,
  validateHydrationConfigPartial,
  type HydrationPacingConfigPatch,
} from "@/lib/hydration/hydration-config"

export async function GET() {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult
  const db = getDb()
  const userUid = linkedPersonAccountUid(db, session)
  if (!userUid) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const person = findPersonalLinkPerson(db, session)
  const config = person
    ? getHydrationConfigForUserUids(db, hydrationSettingsCandidateUids(db, person, session))
    : getHydrationConfig(db, userUid)
  return NextResponse.json(config)
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult
  const db = getDb()
  const userUid = linkedPersonAccountUid(db, session)
  if (!userUid) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const person = findPersonalLinkPerson(db, session)

  let body: HydrationPacingConfigPatch
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const partial = patchBodyToPartial(body)
  if (
    partial.activeStart === undefined &&
    partial.activeEnd === undefined &&
    partial.glassSize === undefined
  ) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 })
  }

  const existing = person
    ? getHydrationConfigForUserUids(db, hydrationSettingsCandidateUids(db, person, session))
    : getHydrationConfig(db, userUid)
  const validated = validateHydrationConfigPartial(partial, existing)
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  try {
    const config = setHydrationConfig(db, userUid, validated.normalised, existing, {
      actorEmail: session.user?.email,
    })
    return NextResponse.json(config)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not save settings"
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
