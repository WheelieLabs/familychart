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

async function reactivate(personId: number) {
  const { POST } = await import("@/app/api/people/[id]/reactivate/route")
  return POST(new NextRequest(`http://localhost/api/people/${personId}/reactivate`, { method: "POST" }), {
    params: Promise.resolve({ id: String(personId) }),
  })
}

describe("POST /api/people/[id]/reactivate", () => {
  beforeEach(async () => {
    testDb = new Database(":memory:")
    applyBaselineSchema(testDb)
    await seedExportHousehold(testDb)
    signInAs(3, "manager@example.com")
  })

  afterEach(() => {
    testDb.close()
    vi.clearAllMocks()
  })

  it("puts a removed Person back on the family list and audits the change", async () => {
    const res = await reactivate(3)
    expect(res.status).toBe(200)
    expect(testDb.prepare("SELECT is_active FROM people WHERE id = 3").get()).toEqual({ is_active: 1 })
    expect(testDb.prepare(
      "SELECT user_email, action, entity_type, entity_id, details FROM audit_log WHERE action = 'UPDATE' AND entity_id = 3",
    ).get()).toEqual({
      user_email: "manager@example.com",
      action: "UPDATE",
      entity_type: "people",
      entity_id: 3,
      details: JSON.stringify({ event: "Person reactivated" }),
    })
  })

  it("refuses a ReadWrite Account", async () => {
    signInAs(4, "writer@example.com")
    const res = await reactivate(3)
    expect(res.status).toBe(403)
    expect(testDb.prepare("SELECT is_active FROM people WHERE id = 3").get()).toEqual({ is_active: 0 })
  })

  it("refuses to reactivate someone who is already on the family list", async () => {
    const res = await reactivate(1)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "This person is already on the family list" })
  })
})
