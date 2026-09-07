// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import { getDb } from "@/lib/db"
import { getVapidConfig } from "@/lib/vapid-config"

export async function GET() {
  const cfg = getVapidConfig(getDb())
  if (!cfg) {
    return NextResponse.json({ error: "Push notifications not configured" }, { status: 503 })
  }
  return NextResponse.json({ vapidPublicKey: cfg.publicKey })
}
