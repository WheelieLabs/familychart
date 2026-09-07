// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { refreshLocalUserSession } from "@/lib/local-user-session"
import { canRead, canWrite, canManage, isAdmin, canReadForPerson, canWriteForPerson, hasAnyReadablePerson } from "@/lib/permissions"
import type { AppSession, AppUser } from "@/lib/session"
import type { Person } from "@/lib/domain-types"
import { parseLocalAccountUid } from "@/lib/account/account-uid"

/** AppSession with user guaranteed non-null (post requireAuth check). */
type AuthedSession = Omit<AppSession, "user"> & { user: AppUser }

export interface AuthedContext {
  session: AuthedSession
  groups: string[]
}

function forbidden(): NextResponse {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

async function resolveAuth(): Promise<AuthedContext | NextResponse> {
  const session = (await auth()) as AppSession | null
  if (!session?.user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const localId = parseLocalAccountUid(session.user.id)
  let groups = session.user.groups ?? []
  const sessionVersion = (session as AppSession & { sessionVersion?: number }).sessionVersion

  if (localId != null) {
    const refreshed = refreshLocalUserSession(getDb(), localId, sessionVersion)
    if (!refreshed) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }
    groups = refreshed.groups
  }

  return {
    session: { ...(session as AuthedSession), user: { ...session.user, groups } },
    groups,
  }
}

/**
 * Validates the session for an API route handler.
 * Returns an AuthedContext on success, or a 401 NextResponse that the caller must return.
 * Use for routes with complex per-person permission checks; prefer requireRead / requireManage
 * etc. for routes with a single top-level role requirement.
 */
export async function requireAuth(): Promise<AuthedContext | NextResponse> {
  return resolveAuth()
}

/** Auth + canRead, or personal-link access to at least one active person. */
export async function requireRead(): Promise<AuthedContext | NextResponse> {
  const ctx = await resolveAuth()
  if (ctx instanceof NextResponse) return ctx
  if (canRead(ctx.groups)) return ctx
  const uids = getDb()
    .prepare("SELECT account_uid FROM people WHERE is_active = 1")
    .all() as Array<{ account_uid: string | null }>
  if (hasAnyReadablePerson(uids.map(r => r.account_uid), ctx.groups, ctx.session.user)) {
    return ctx
  }
  return forbidden()
}

/** Auth + canWrite. Returns 401 if unauthenticated, 403 if role insufficient. */
export async function requireWrite(): Promise<AuthedContext | NextResponse> {
  const ctx = await resolveAuth()
  if (ctx instanceof NextResponse) return ctx
  if (!canWrite(ctx.groups)) return forbidden()
  return ctx
}

/** Auth + canManage. Returns 401 if unauthenticated, 403 if role insufficient. */
export async function requireManage(): Promise<AuthedContext | NextResponse> {
  const ctx = await resolveAuth()
  if (ctx instanceof NextResponse) return ctx
  if (!canManage(ctx.groups)) return forbidden()
  return ctx
}

/** Auth + isAdmin. Returns 401 if unauthenticated, 403 if role insufficient. */
export async function requireAdmin(): Promise<AuthedContext | NextResponse> {
  const ctx = await resolveAuth()
  if (ctx instanceof NextResponse) return ctx
  if (!isAdmin(ctx.groups)) return forbidden()
  return ctx
}

/**
 * Loads person by id and verifies the session has read or write access.
 * Returns the Person row on success, or a 404 NextResponse on failure.
 * Always 404 (not 403) so unauthorised callers cannot probe person existence.
 */
export function authorisePersonAccess(
  db: Database.Database,
  ctx: AuthedContext,
  personId: number,
  mode: "read" | "write",
): Person | NextResponse {
  const person = db
    .prepare("SELECT * FROM people WHERE id = ? AND is_active = 1")
    .get(personId) as Person | undefined
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const allowed =
    mode === "read"
      ? canReadForPerson(ctx.groups, ctx.session.user, person.account_uid)
      : canWriteForPerson(ctx.groups, ctx.session.user, person.account_uid)
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return person
}
