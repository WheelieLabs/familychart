// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@/lib/logger"

import { timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { runCronJobs } from "@/lib/cron"

function cronAuthorised(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return false

  const header = request.headers.get("x-cron-secret") ?? ""
  const expected = Buffer.from(secret)
  const received = Buffer.from(header)
  if (expected.length !== received.length) return false
  return timingSafeEqual(expected, received)
}

export async function GET(request: NextRequest) {
  if (process.env.CRON_MODE === "internal") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  if (!cronAuthorised(request)) {
    logger.warn("cron_unauthorised", { path: "/api/cron" })
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
  }

  try {
    const result = await runCronJobs()
    return NextResponse.json({ ok: true, sent: result.sent })
  } catch (err) {
    logger.error("[cron] runCronJobs failed:", err)
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 })
  }
}
