// SPDX-License-Identifier: AGPL-3.0-only

import { NextRequest, NextResponse } from "next/server"
import { requireAuth, authorisePersonAccess } from "@/lib/auth/auth-helpers"
import { getDb } from "@/lib/db"
import { auditLog } from "@/lib/audit-log"
import { parseLocalYmd } from "@/lib/schedule/dose-expectation-input"
import { getDoseExpectationOwner } from "@/lib/schedule/dose-expectation-store"

interface Params {
  params: Promise<{ id: string }>
}

async function authorise(params: Params["params"]) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { id } = await params
  const expectationId = parseInt(id, 10)
  if (!Number.isFinite(expectationId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  const db = getDb()
  const owner = getDoseExpectationOwner(db, expectationId)
  if (!owner) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const person = authorisePersonAccess(db, authResult, owner.personId, "write")
  if (person instanceof NextResponse) return person
  return { db, owner, email: authResult.session.user?.email ?? null }
}

/** One-off skip day (pupil-free day, holiday, sick day) for an expectation. */
export async function POST(request: NextRequest, { params }: Params) {
  const ctx = await authorise(params)
  if (ctx instanceof NextResponse) return ctx

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const ymd = parseLocalYmd(body.local_ymd)
  if (!ymd) return NextResponse.json({ error: "local_ymd must be a valid date (YYYY-MM-DD)" }, { status: 400 })

  ctx.db
    .prepare("INSERT OR IGNORE INTO dose_expectation_exceptions (dose_expectation_id, local_ymd) VALUES (?, ?)")
    .run(ctx.owner.expectationId, ymd)
  auditLog(ctx.db, ctx.email, "CREATE", "dose_expectations", ctx.owner.expectationId, { exception: ymd })
  return NextResponse.json({ ok: true }, { status: 201 })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const ctx = await authorise(params)
  if (ctx instanceof NextResponse) return ctx

  const ymd = parseLocalYmd(new URL(request.url).searchParams.get("local_ymd"))
  if (!ymd) return NextResponse.json({ error: "local_ymd must be a valid date (YYYY-MM-DD)" }, { status: 400 })

  ctx.db
    .prepare("DELETE FROM dose_expectation_exceptions WHERE dose_expectation_id = ? AND local_ymd = ?")
    .run(ctx.owner.expectationId, ymd)
  auditLog(ctx.db, ctx.email, "DELETE", "dose_expectations", ctx.owner.expectationId, { exception: ymd })
  return NextResponse.json({ ok: true })
}
