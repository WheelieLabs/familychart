// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyBaselineSchema } from "@/lib/db"
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

async function preview(personId: number) {
  const { GET } = await import("@/app/api/people/[id]/erase/route")
  return GET(new NextRequest(`http://localhost/api/people/${personId}/erase`), {
    params: Promise.resolve({ id: String(personId) }),
  })
}

describe("GET /api/people/[id]/erase", () => {
  beforeEach(async () => {
    testDb = new Database(":memory:")
    applyBaselineSchema(testDb)
    await seedExportHousehold(testDb)
    signInAs(1, "admin@example.com")
  })

  afterEach(() => {
    testDb.close()
    vi.clearAllMocks()
  })

  it("tells an Admin how much of a Person would be erased, and that backups may keep them", async () => {
    const res = await preview(1)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      name: "Alex",
      is_active: 1,
      counts_label: "2 doses, 4 observations, 1 test result with reports, 1 photo",
      backup_notice: "Backups taken before this erase may still contain this person.",
      account: null,
    })
    expect(testDb.prepare("SELECT name FROM people WHERE id = 1").get()).toEqual({ name: "Alex" })
  })

  it("hides the counts from an Account that cannot erase that Person", async () => {
    signInAs(4, "writer@example.com")
    const res = await preview(1)
    expect(res.status).toBe(404)
  })

  it("shows a linked Account the counts for their own Person", async () => {
    signInAs(2, "sam@example.com")
    const res = await preview(2)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      name: "Sam",
      is_active: 1,
      counts_label: "1 dose, 1 observation, 0 test results with reports, 0 photos",
      backup_notice: "Backups taken before this erase may still contain this person.",
      account: {
        email: "sam@example.com",
        role: "none",
        remove_default: true,
        remove_blocked_reason: null,
        is_own: true,
        is_local: true,
        mfa_enrolled: false,
      },
    })
  })
})
