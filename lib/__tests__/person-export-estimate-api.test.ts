// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyBaselineSchema } from "@/lib/db"
import { __setUploadBlobAdapterForTests, createMemoryUploadBlobAdapter } from "@/lib/uploads/store"
import { seedExportHousehold } from "./helpers/export-fixture"

vi.mock("@/lib/db", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}))

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => session),
}))

let testDb: Database.Database
let session: { user: { id: string; email: string }; sessionVersion: number } | null

function signInAs(accountId: number, email: string) {
  session = { user: { id: `local:${accountId}`, email }, sessionVersion: 0 }
}

async function estimate(personId: number) {
  const { GET } = await import("@/app/api/people/[id]/export/estimate/route")
  return GET(new NextRequest(`http://localhost/api/people/${personId}/export/estimate`), {
    params: Promise.resolve({ id: String(personId) }),
  })
}

describe("GET /api/people/[id]/export/estimate", () => {
  beforeEach(async () => {
    testDb = new Database(":memory:")
    applyBaselineSchema(testDb)
    __setUploadBlobAdapterForTests(createMemoryUploadBlobAdapter())
    await seedExportHousehold(testDb)
  })

  afterEach(() => {
    testDb.close()
    __setUploadBlobAdapterForTests(null)
    vi.clearAllMocks()
  })

  it("lets a None-role Account estimate their own linked Person", async () => {
    signInAs(2, "sam@example.com")
    const res = await estimate(2)
    expect(res.status).toBe(200)
    const body = await res.json() as { total_bytes: number; report_bytes: number }
    expect(body.report_bytes).toBe(0)
    expect(body.total_bytes).toBeGreaterThan(0)
  })

  it("refuses a linked Account estimating someone else", async () => {
    signInAs(2, "sam@example.com")
    expect((await estimate(1)).status).toBe(404)
  })

  it("refuses an Account with no Personal-link", async () => {
    signInAs(5, "unlinked@example.com")
    expect((await estimate(2)).status).toBe(404)
  })

  it("lets an Admin estimate an inactive Person", async () => {
    signInAs(1, "admin@example.com")
    const res = await estimate(3)
    expect(res.status).toBe(200)
    expect((await res.json() as { report_bytes: number }).report_bytes).toBe(0)
  })
})
