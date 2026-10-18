// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { confirmAppLockReauth } from "@/lib/account/account-local-reauth"
import { parseLocalAccountUid } from "@/lib/account/account-uid"
import { sessionAccountUids } from "@/lib/account/account-identity"
import { isLastLocalAdmin } from "@/lib/account/last-local-admin"
import { isOwnAccount } from "@/lib/account/own-account"
import { isNoneRole } from "@/lib/account/none-role"
import type { AuthedContext } from "@/lib/auth/auth-helpers"
import { requireAuth } from "@/lib/auth/auth-helpers"
import { isEntraAppLockReauthFresh } from "@/lib/app-lock/app-lock-reauth"
import { clientIpFromHeaders } from "@/lib/client-ip"
import { isDemoModeActive } from "@/lib/demo/demo-mode"
import { isAdmin } from "@/lib/permissions"
import { getDb } from "@/lib/db"
import { actorRoleForLog, logDataEvent } from "@/lib/data-event-log"
import { logger } from "@/lib/logger"
import { exportsInFlight } from "@/lib/export/export-registry"
import { bumpLocalUserSessionVersion } from "@/lib/local-user-session"
import { erasePerson, type PersonEraseResult } from "@/lib/person/person-erase"
import { previewPersonErase } from "@/lib/person/person-erase-preview"
import type Database from "better-sqlite3-multiple-ciphers"

interface Params { params: Promise<{ id: string }> }

async function requireSelfReauth(
  ctx: AuthedContext,
  db: Database.Database,
  body: { password?: string; otp?: string },
  request: NextRequest,
): Promise<NextResponse | null> {
  const localId = parseLocalAccountUid(ctx.session.user.id)
  if (localId == null) {
    if (!isEntraAppLockReauthFresh(ctx.session.entraAuthTime, Date.now())) {
      return NextResponse.json({ error: "Sign in again to erase your records" }, { status: 401 })
    }
    return null
  }
  if (!body.password) {
    return NextResponse.json({ error: "Confirm your password to erase your records" }, { status: 401 })
  }
  const proof = await confirmAppLockReauth(db, localId, {
    password: body.password,
    otp: body.otp,
    ip: clientIpFromHeaders(request.headers),
  })
  if (proof.ok) return null
  if (proof.reason === "rate_limited") {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 })
  }
  if (proof.reason === "otp_missing" || proof.reason === "otp_invalid") {
    return NextResponse.json({ error: "Authenticator code is incorrect" }, { status: 401 })
  }
  return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 })
}

function maySeeErase(
  ctx: AuthedContext,
  person: { account_uid: string | null },
): boolean {
  if (isAdmin(ctx.groups)) return true
  return Boolean(person.account_uid && sessionAccountUids(ctx.session.user).includes(person.account_uid))
}

/** Counts for the confirmation screen. Does not erase. */
export async function GET(_request: NextRequest, { params }: Params) {
  const ctx = await requireAuth()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  const personId = parseInt(id, 10)
  if (!Number.isFinite(personId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }
  const db = getDb()
  const person = db.prepare("SELECT id, account_uid FROM people WHERE id = ?").get(personId) as
    { id: number; account_uid: string | null } | undefined
  if (!person || !maySeeErase(ctx, person)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const preview = previewPersonErase(db, personId, ctx.session.user.id)
  if (!preview) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(preview)
}

export async function POST(request: NextRequest, { params }: Params) {
  const ctx = await requireAuth()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  const personId = parseInt(id, 10)
  if (!Number.isFinite(personId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }

  const db = getDb()
  const person = db.prepare("SELECT id, account_uid, is_active FROM people WHERE id = ?").get(personId) as
    { id: number; account_uid: string | null; is_active: number } | undefined
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (isDemoModeActive()) {
    return NextResponse.json({ error: "Erasing a person is disabled in demo mode" }, { status: 403 })
  }

  let body: { password?: string; otp?: string; remove_account?: boolean } = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const self = Boolean(
    person.account_uid && sessionAccountUids(ctx.session.user).includes(person.account_uid),
  )
  // Erasing your own active Person is the self-service "Remove my records": it takes you off the family list and
  // erases in one step, so it asks for re-proof and needs no deactivation first, even for an Admin. An Admin
  // erasing their own already-deactivated Person takes the admin path below.
  let reproved = false
  if (self && (person.is_active || !isAdmin(ctx.groups))) {
    const reauth = await requireSelfReauth(ctx, db, body, request)
    if (reauth) return reauth
    reproved = true
  } else if (isAdmin(ctx.groups)) {
    if (person.is_active) {
      return NextResponse.json({ error: "Deactivate this person before erasing them" }, { status: 409 })
    }
  } else {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  if (exportsInFlight(personId) > 0) {
    return NextResponse.json({ error: "An export of this person is still downloading" }, { status: 409 })
  }

  const linkedId = parseLocalAccountUid(person.account_uid)
  const linked = (linkedId != null
    ? db.prepare("SELECT id, role, external_id FROM accounts WHERE id = ?").get(linkedId)
    : person.account_uid
      ? db.prepare("SELECT id, role, external_id FROM accounts WHERE external_id = ?").get(person.account_uid)
      : undefined) as { id: number; role: string; external_id: string | null } | undefined
  const removeBlocked = linked != null && isLastLocalAdmin(db, linked.id)
  const removeAccountToo = body.remove_account === true && linked != null && !removeBlocked
  // An Admin removing their own Account through the erase proves it afresh, as /api/me/remove-account does.
  if (removeAccountToo && !reproved && isAdmin(ctx.groups) && isOwnAccount(ctx.session.user.id, linked!)) {
    const reauth = await requireSelfReauth(ctx, db, body, request)
    if (reauth) return reauth
  }
  const signOutNoneRole = linked != null && isNoneRole(linked.role) && !removeAccountToo
  const keepHouseholdRole = linked != null && !isNoneRole(linked.role) && !removeAccountToo

  const actorEmail = ctx.session.user.email ?? null
  let result: PersonEraseResult
  try {
    result = await erasePerson(db, personId, actorEmail, new Date(), removeAccountToo
      ? { removeAccountId: linked!.id, actorRole: actorRoleForLog(ctx.groups) }
      : undefined)
  } catch (err) {
    // The cause is a database error naming a table or constraint, never a value, so it is safe to log.
    logger.error("person_erase_failed", {
      err: err instanceof Error ? err.message : "unknown",
      code: (err as { code?: unknown } | null)?.code,
    })
    logDataEvent({
      event: "person_erased",
      outcome: "failed",
      actorRole: actorRoleForLog(ctx.groups),
      counts: { persons: 0, records: 0, attachments: 0 },
    })
    return NextResponse.json({ error: "Erase failed" }, { status: 500 })
  }

  const payload = {
    ...result,
    account_outcome: removeAccountToo
      ? "removed" as const
      : signOutNoneRole
        ? "deactivated" as const
        : keepHouseholdRole
          ? "kept" as const
          : null,
    account_note: keepHouseholdRole
      ? "This account has a household role, so it was left able to sign in."
      : null,
  }
  if (signOutNoneRole && linked) {
    try {
      db.prepare("UPDATE accounts SET is_active = 0 WHERE id = ?").run(linked.id)
      bumpLocalUserSessionVersion(db, linked.id)
    } catch {
      logger.error("account_sign_out_failed")
    }
  }
  const { files, ...recordCounts } = result.counts
  const records = Object.values(recordCounts).reduce((sum, count) => sum + count, 0)
  logDataEvent({
    event: "person_erased",
    outcome: "erased",
    actorRole: actorRoleForLog(ctx.groups),
    counts: { ...result.counts, persons: 1, records, attachments: files },
    fileFailures: result.file_failures.length,
    accountOutcome: payload.account_outcome,
  })
  return NextResponse.json(payload)
}
