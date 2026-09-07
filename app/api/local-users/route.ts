// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { requireAdmin } from "@/lib/auth/auth-helpers"
import { isDemoModeActive } from "@/lib/demo/demo-mode"
import { rejectDemoProfanity } from "@/lib/demo/demo-profanity-guard"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import type { Account } from "@/lib/domain-types"
import { VALID_ROLES } from "@/lib/account/account-roles"
import { isEmailTakenByAnyAccount } from "@/lib/local-account-gate"

export async function GET() {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult

  const db = getDb()
  const users = db.prepare(
    `SELECT id, email, role, can_report, is_active, created_at,
       CASE WHEN totp_secret IS NOT NULL AND totp_secret != '' THEN 1 ELSE 0 END AS mfa_enrolled
     FROM accounts ORDER BY email`
  ).all()
  return NextResponse.json(users)
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin()
  if (authResult instanceof NextResponse) return authResult
  const { session, groups } = authResult
  if (isDemoModeActive())
    return NextResponse.json({ error: "This is a demo environment — account changes are disabled." }, { status: 403 })

  const body = await request.json()
  const email =
    typeof body.email === "string" ? body.email.trim() : ""
  const profanity = await rejectDemoProfanity(email)
  if (profanity) return profanity
  const password = typeof body.password === "string" ? body.password : undefined
  const role = typeof body.role === "string" ? body.role : undefined
  const can_report = body.can_report ? 1 : 0

  if (!email)                      return NextResponse.json({ error: "Email is required" }, { status: 400 })
  if (!password)                   return NextResponse.json({ error: "Password is required" }, { status: 400 })
  if (!role || !VALID_ROLES.has(role))
                                   return NextResponse.json({ error: "Invalid role" }, { status: 400 })

  const db = getDb()
  if (isEmailTakenByAnyAccount(db, email)) {
    return NextResponse.json({ error: "Email already exists" }, { status: 409 })
  }

  const password_hash = await bcrypt.hash(password, 12)
  let newId: number
  try {
    const result = db.prepare(
      "INSERT INTO accounts (email, password_hash, role, can_report) VALUES (?, ?, ?, ?)"
    ).run(email, password_hash, role, can_report)
    newId = Number(result.lastInsertRowid)
  } catch (err) {
    // The pre-check above and this INSERT aren't atomic (bcrypt's await between them is a
    // real yield point) — a same-case duplicate racing this request lands here instead of
    // slipping through; accounts.email's plain UNIQUE constraint is case-sensitive, so a
    // case-varied race still isn't caught (would need a COLLATE NOCASE index — out of scope
    // for this fix).
    if (err != null && typeof err === "object" && "code" in err && err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 })
    }
    throw err
  }
  auditLog(db, session.user?.email, "CREATE", "accounts", newId, { email, role, can_report })

  const created = db.prepare(
    "SELECT id, email, role, can_report, is_active, created_at FROM accounts WHERE id = ?"
  ).get(newId) as Omit<Account, "password_hash">

  return NextResponse.json(created, { status: 201 })
}
