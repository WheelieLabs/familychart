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

async function listPeople(url: string) {
  const { GET } = await import("@/app/api/people/route")
  return GET(new NextRequest(url))
}

describe("GET /api/people for Data Export & Restore", () => {
  beforeEach(async () => {
    testDb = new Database(":memory:")
    applyBaselineSchema(testDb)
    __setUploadBlobAdapterForTests(createMemoryUploadBlobAdapter())
    await seedExportHousehold(testDb)
    signInAs(1, "admin@example.com")
  })

  afterEach(() => {
    testDb.close()
    __setUploadBlobAdapterForTests(null)
    vi.clearAllMocks()
  })

  it("lists an inactive Person when an Admin asks for the export list", async () => {
    const res = await listPeople("http://localhost/api/people?include_inactive=1")
    expect(res.status).toBe(200)
    const rows = await res.json() as { name: string; is_active: number }[]
    expect(rows.find(p => p.name === "Robin")).toEqual(expect.objectContaining({ name: "Robin", is_active: 0 }))
    expect(rows.map(p => p.name).sort()).toEqual(["Alex", "Robin", "Sam"])
  })

  it("includes each Person's export size on the export list", async () => {
    const res = await listPeople("http://localhost/api/people?include_inactive=1")
    const rows = await res.json() as { name: string; export_total_bytes: number; export_report_bytes: number }[]
    const alex = rows.find(p => p.name === "Alex")
    expect(alex?.export_report_bytes).toBe("iron-pdf-bytes".length)
    expect(alex!.export_total_bytes).toBeGreaterThan(alex!.export_report_bytes + "alex-jpeg-bytes".length)
    expect(rows.find(p => p.name === "Robin")?.export_report_bytes).toBe(0)
  })

  it("leaves inactive Persons off the ordinary list", async () => {
    const res = await listPeople("http://localhost/api/people")
    const rows = await res.json() as { name: string }[]
    expect(rows.map(p => p.name).sort()).toEqual(["Alex", "Sam"])
  })

  it("does not reveal inactive Persons to a Manager", async () => {
    signInAs(3, "manager@example.com")
    const res = await listPeople("http://localhost/api/people?include_inactive=1")
    const rows = await res.json() as { name: string }[]
    expect(rows.map(p => p.name)).not.toContain("Robin")
  })

  it("shows a None-role Account only their linked Person", async () => {
    signInAs(2, "sam@example.com")
    const res = await listPeople("http://localhost/api/people?include_inactive=1")
    const rows = await res.json() as { name: string }[]
    expect(rows.map(p => p.name)).toEqual(["Sam"])
  })
})
