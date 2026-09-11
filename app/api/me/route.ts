// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/auth-helpers"
import { canonicalAccountUid, sessionAccountUids } from "@/lib/account/account-identity"
import { getDb } from "@/lib/db"
import { getObservationGoal } from "@/lib/observation/observation-goals"
import { localUserNeedsMfaEnrollment, isMfaRequiredPolicyActive } from "@/lib/account/account-local-reauth"
import { parseLocalAccountUid } from "@/lib/account/account-uid"
import { getUserRole } from "@/lib/permissions"
import { resolveSetting } from "@/lib/settings/resolver"
import { SETTING_SECURITY_PASSWORD_MIN_LENGTH } from "@/lib/settings/registry"
import { resolveMeasurementSystem } from "@/lib/measurement-system"
import { resolveAgeTimezone } from "@/lib/instance-timezone"

export async function GET() {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult

  const role   = getUserRole(groups)
  const uid     = canonicalAccountUid(session)
  const linkIds = sessionAccountUids(session.user)

  const linkedPerson =
    linkIds.length > 0
      ? getDb()
          .prepare(
            `SELECT id, name, full_name, photo_url, color FROM people
             WHERE is_active = 1 AND account_uid IN (${linkIds.map(() => "?").join(",")})`
          )
          .get(...linkIds) as
          | {
              id: number
              name: string
              full_name: string | null
              photo_url: string | null
              color: string
            }
          | undefined
      : undefined

  const localId = parseLocalAccountUid(uid)
  let needsMfaEnrollment = false
  let mfaEnrolled        = false
  let mfaPolicyRequired  = false
  let passwordMinLength  = 10
  let measurementSystem: "metric" | "imperial" = "metric"
  let instanceTimezone = "UTC"
  let hydrationGoalMl: number | null = null
  if (linkedPerson) {
    const goal = getObservationGoal(getDb(), linkedPerson.id, "Hydration")
    hydrationGoalMl = goal?.target_value ?? null
  }
  {
    const db = getDb()
    passwordMinLength = parseInt(resolveSetting(db, SETTING_SECURITY_PASSWORD_MIN_LENGTH).value, 10)
    measurementSystem = resolveMeasurementSystem(db)
    instanceTimezone = resolveAgeTimezone(db)
    if (localId != null) {
      needsMfaEnrollment = localUserNeedsMfaEnrollment(db, localId)
      mfaPolicyRequired = isMfaRequiredPolicyActive(db)
      const row = db
        .prepare(`SELECT totp_secret FROM accounts WHERE id = ? AND is_active = 1`)
        .get(localId) as { totp_secret: string | null } | undefined
      mfaEnrolled = !!(row?.totp_secret && row.totp_secret.length > 0)
    }
  }

  return NextResponse.json({
    id:     uid,
    name:   session.user.name,
    email:  session.user.email,
    image:  session.user.image ?? null,
    role,
    isLocal: uid?.startsWith("local:") ?? false,
    needsMfaEnrollment,
    mfaEnrolled,
    mfaPolicyRequired,
    passwordMinLength,
    measurementSystem,
    instanceTimezone,
    linkedPerson: linkedPerson ?? null,
    hydrationGoalMl,
  })
}
