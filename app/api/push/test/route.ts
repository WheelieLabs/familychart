// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@/lib/logger"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canonicalAccountUid } from "@/lib/account/account-identity"
import { getDb } from "@/lib/db"
import { sendAndLogPush } from "@/lib/push"
import type { AppSession } from "@/lib/session"
import type { PushEndpoint } from "@/lib/domain-types"

export async function POST() {
  const session = (await auth()) as AppSession | null
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const userUid = canonicalAccountUid(session)
  if (!userUid) return NextResponse.json({ error: "No user identity" }, { status: 400 })

  const db = getDb()
  const endpoints = db
    .prepare("SELECT endpoint, p256dh, web_push_auth FROM push_endpoints WHERE user_uid = ?")
    .all(userUid) as Pick<PushEndpoint, "endpoint" | "p256dh" | "web_push_auth">[]

  if (endpoints.length === 0) {
    return NextResponse.json({ error: "No device registered on this account" }, { status: 400 })
  }

  try {
    const { sent, errors } = await sendAndLogPush(db, endpoints, {
      title: "FamilyChart",
      body: "Test notification — push is working!",
      url: "/",
    })
    // Per-endpoint failures are collected rather than thrown, so a send that
    // reached zero devices still resolves successfully. Treat that as a
    // failure here — otherwise a broken send path reports success while
    // nothing is actually delivered.
    if (sent === 0) {
      logger.error("[push/test] no notifications delivered:", errors)
      return NextResponse.json({ error: "Push send failed" }, { status: 500 })
    }
    return NextResponse.json({ ok: true, sent })
  } catch (err) {
    logger.error("[push/test] send failed:", err)
    return NextResponse.json({ error: "Push send failed" }, { status: 500 })
  }
}
