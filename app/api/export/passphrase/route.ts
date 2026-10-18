// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/auth-helpers"
import { formatExportPassphrase, generateExportPassphrase } from "@/lib/export/export-passphrase"

export const dynamic = "force-dynamic"

/** A fresh passphrase for the download dialog. Nothing about it is stored. */
export async function POST() {
  const ctx = await requireAuth()
  if (ctx instanceof NextResponse) return ctx
  return NextResponse.json({ passphrase: formatExportPassphrase(generateExportPassphrase()) })
}
