// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import { APP_VERSION } from "@/lib/version"
import { isDemoModeActive } from "@/lib/demo/demo-mode"

export const dynamic = "force-dynamic"

/** Unauthenticated deploy version probe — used by the client bundle freshness check. */
export async function GET() {
  const demoVersion = isDemoModeActive() ? (process.env.DEMO_VERSION ?? null) : null
  return NextResponse.json(
    { version: APP_VERSION, ...(demoVersion ? { demoVersion } : {}) },
    { headers: { "Cache-Control": "no-store" } },
  )
}
