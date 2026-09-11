// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { isDemoModeActive } from "@/lib/demo/demo-mode"
import { rejectDemoProfanity } from "@/lib/demo/demo-profanity-guard"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { isOutboundEmailConfigured, sendOutboundEmail } from "@/lib/email-send"
import { createInvite, listInvitesForAdmin } from "@/lib/invite"
import { VALID_ROLES } from "@/lib/account/account-roles"
import { publicOrigin } from "@/lib/reverse-proxy"

const VALID_PERSON_ACTIONS = new Set(["link", "create", "none"])

interface InviteRequestBody {
  email?: unknown
  role?: unknown
  personAction?: unknown
  personId?: unknown
  personName?: unknown
}

/**
 * List includes invite/status fields and a computed `linkable` flag — false for a dead
 * invite (expired without being resent, or explicitly revoked) — so the manual person-link
 * dropdown (Phase 5) can exclude it without a second round-trip.
 */
export async function GET() {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult

  return NextResponse.json(listInvitesForAdmin(getDb()))
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  const { session } = authResult
  if (isDemoModeActive())
    return NextResponse.json({ error: "This is a demo environment — account changes are disabled." }, { status: 403 })

  const db = getDb()
  if (!isOutboundEmailConfigured(db)) {
    return NextResponse.json(
      { error: "Outbound email is not configured on this instance" },
      { status: 400 },
    )
  }

  const body = (await request.json()) as InviteRequestBody
  // Lowercased: lib/invite.ts's claimInviteForEntra matches an Entra sign-in's email against
  // accounts.email via lower(email), so an invite created with different casing than a
  // later Entra sign-in's profile email would otherwise never match, or — worse — two
  // invites differing only in case would both succeed and collide unpredictably at match time.
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
  const role = typeof body.role === "string" ? body.role : undefined
  const personAction = typeof body.personAction === "string" ? body.personAction : undefined
  const personId = typeof body.personId === "number" ? body.personId : undefined
  const personName = typeof body.personName === "string" ? body.personName.trim() : ""

  const profanity = await rejectDemoProfanity(email, personName)
  if (profanity) return profanity

  if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 })
  if (!role || !VALID_ROLES.has(role))
    return NextResponse.json({ error: "Invalid role" }, { status: 400 })
  if (!personAction || !VALID_PERSON_ACTIONS.has(personAction))
    return NextResponse.json({ error: "Invalid person decision" }, { status: 400 })
  if (personAction === "link" && personId == null)
    return NextResponse.json({ error: "personId is required to link an existing Person" }, { status: 400 })
  if (personAction === "create" && !personName)
    return NextResponse.json({ error: "Person name is required" }, { status: 400 })

  const result = createInvite(
    db,
    { email, role, personAction: personAction as "link" | "create" | "none", personId, personName },
    { origin: publicOrigin(request.headers, request.nextUrl.origin), inviter: session.user ?? {} },
  )
  if (!result.ok) {
    if (result.reason === "email_taken") {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 })
    }
    if (result.reason === "person_not_found") {
      return NextResponse.json({ error: "Person not found" }, { status: 404 })
    }
    return NextResponse.json({ error: "This Person already has a linked Account" }, { status: 409 })
  }

  auditLog(db, session.user?.email, "CREATE", "accounts", result.account.id, {
    email,
    role,
    invited: true,
    personAction,
  })

  const emailResult = await sendOutboundEmail(db, result.mail)

  if (!emailResult.ok) {
    // The account row is kept regardless — the admin can retry delivery via Resend
    // (Phase 6) rather than losing the role/person-link work already done.
    return NextResponse.json(
      { account: result.account, emailError: emailResult.error },
      { status: 201 },
    )
  }

  return NextResponse.json({ account: result.account }, { status: 201 })
}
