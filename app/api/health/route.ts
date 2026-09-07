// SPDX-License-Identifier: AGPL-3.0-only

import { logger } from "@/lib/logger"
import { emitHealthyFromHealthcheck } from "@/lib/ops-health-log"

import { NextResponse } from "next/server"
import { getDb } from "@/lib/db"
import { probeKeyserverHealth } from "@/lib/encryption/db-key"
import { getEncryptionMode } from "@/lib/encryption/mode"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    getDb().prepare("SELECT 1").get()

    const mode = getEncryptionMode()

    if (mode === "keyserver") {
      const ks = await probeKeyserverHealth()
      if (!ks.ok) {
        // Detail (URL, HTTP status, fetch error message) stays server-side only —
        // never on the anonymous response.
        logger.warn("keyserver_health_probe_failed", { detail: ks.error })
        return NextResponse.json(
          { status: "degraded", db: "connected", keyserver: "unreachable" },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        )
      }
      emitHealthyFromHealthcheck()
      return NextResponse.json(
        { status: "ok", db: "connected", keyserver: "reachable" },
        { headers: { "Cache-Control": "no-store" } },
      )
    }

    emitHealthyFromHealthcheck()

    return NextResponse.json({ status: "ok", db: "connected" }, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (err) {
    logger.error("GET /api/health failed:", err)
    return NextResponse.json({ status: "error", db: "unreachable" }, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    })
  }
}
