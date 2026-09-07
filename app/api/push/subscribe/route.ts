// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { canonicalAccountUid, findPersonalLinkPerson } from "@/lib/account/account-identity"
import { validatePushEndpoint } from "@/lib/push/push-endpoint-validation"
import { getDb } from "@/lib/db"
import { hasAnyReadablePerson } from "@/lib/permissions"

export async function POST(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult

  const db = getDb()
  const userUid = canonicalAccountUid(session)
  const peopleUids = db
    .prepare("SELECT account_uid FROM people WHERE is_active = 1")
    .all() as Array<{ account_uid: string | null }>
  if (!userUid || !hasAnyReadablePerson(peopleUids.map(r => r.account_uid), groups, session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body?.endpoint || !body?.p256dh || !body?.auth) {
    return NextResponse.json({ error: "endpoint, p256dh and auth are required" }, { status: 400 })
  }

  const { endpoint, p256dh, auth: pushAuth, person_id } = body as {
    endpoint: string
    p256dh: string
    auth: string
    person_id?: number
  }

  const endpointError = await validatePushEndpoint(endpoint)
  if (endpointError) {
    return NextResponse.json({ error: endpointError }, { status: 400 })
  }

  const userAgent = request.headers.get("user-agent") ?? null

  db.prepare(`
    INSERT INTO push_endpoints (user_uid, endpoint, p256dh, web_push_auth, user_agent, last_used_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_uid, endpoint) DO UPDATE SET
      p256dh = excluded.p256dh,
      web_push_auth = excluded.web_push_auth,
      last_used_at = CURRENT_TIMESTAMP
  `).run(userUid, endpoint, p256dh, pushAuth, userAgent)

  // Auto-subscribe to the user's own Personal-linked person on every device registration
  const linkedPerson = findPersonalLinkPerson(db, session)
  if (linkedPerson) {
    db.prepare(`
      INSERT OR IGNORE INTO person_notification_prefs
        (person_id, user_uid, notify_prn, notify_prescribed, notify_overdue, notify_observations, notify_hydration)
      VALUES (?, ?, 1, 1, 1, 0, 1)
    `).run(linkedPerson.id, userUid)
  }

  // Explicit person subscription (caregiver following another person).
  // Must hold read access to the target person — otherwise any authenticated
  // reader could plant a notification-pref row and receive that person's
  // medication reminders (IDOR). authorisePersonAccess 404s on denial.
  if (person_id != null) {
    const person = authorisePersonAccess(db, authResult, person_id, "read")
    if (person instanceof NextResponse) return person
    db.prepare(`
      INSERT OR IGNORE INTO person_notification_prefs
        (person_id, user_uid, notify_prn, notify_prescribed, notify_overdue, notify_observations, notify_hydration)
      VALUES (?, ?, 1, 1, 1, 0, 0)
    `).run(person_id, userUid)
  }

  return NextResponse.json({ ok: true })
}
