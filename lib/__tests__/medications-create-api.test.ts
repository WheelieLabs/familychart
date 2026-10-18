// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { NextRequest, NextResponse } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyBaselineSchema } from "@/lib/db"

let testDb: Database.Database
let sessionUser: { email: string; id: string; groups: string[] } | null

vi.mock("@/lib/db", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}))

vi.mock("@/lib/auth/auth-helpers", () => ({
  requireAuth: vi.fn(async () =>
    sessionUser
      ? { session: { user: sessionUser }, groups: sessionUser.groups }
      : NextResponse.json({ error: "Unauthorised" }, { status: 401 }),
  ),
}))

const REFUSAL = "Ask a Manager or Administrator to add this medication."

const post = async (body: object) => {
  const { POST } = await import("@/app/api/medications/route")
  return POST(
    new NextRequest("http://localhost/api/medications", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  )
}

const medicationNames = () =>
  (testDb.prepare("SELECT name FROM medications ORDER BY id").all() as { name: string }[]).map(r => r.name)

describe("POST /api/medications", () => {
  beforeEach(() => {
    testDb = new Database(":memory:")
    testDb.pragma("foreign_keys = ON")
    applyBaselineSchema(testDb)
    testDb.prepare("INSERT INTO people (id, name, account_uid) VALUES (1, 'Alice', 'local:1')").run()
    testDb.prepare("INSERT INTO people (id, name, account_uid) VALUES (2, 'Bob', 'local:2')").run()
    testDb.prepare("INSERT INTO people (id, name, account_uid, is_active) VALUES (3, 'Cleo', 'local:4', 0)").run()
    sessionUser = { email: "carer@test", id: "local:9", groups: ["local:write"] }
  })

  afterEach(() => {
    testDb.close()
  })

  it("lets a ReadWrite Account create a medication with no Person, as before", async () => {
    const res = await post({ name: "Amoxicillin", default_dosage: 1, dosage_unit: "Tabs" })
    expect(res.status).toBe(201)
    expect(medicationNames()).toEqual(["Amoxicillin"])
  })

  it("lets a ReadWrite Account create one while recording for any Person", async () => {
    const res = await post({ name: "Amoxicillin", person_id: 2 })
    expect(res.status).toBe(201)
  })

  it("lets a read-only Personal-link Account create a medication for its own Person", async () => {
    sessionUser = { email: "alice@test", id: "local:1", groups: ["local:read"] }
    const res = await post({ name: "Amoxicillin", person_id: 1 })
    expect(res.status).toBe(201)
    expect(medicationNames()).toEqual(["Amoxicillin"])
  })

  it("lets a Role None Personal-link Account create one for its own Person", async () => {
    sessionUser = { email: "alice@test", id: "local:1", groups: [] }
    const res = await post({ name: "Amoxicillin", person_id: 1 })
    expect(res.status).toBe(201)
  })

  it("refuses the same Account for another Person, with a clear message", async () => {
    sessionUser = { email: "alice@test", id: "local:1", groups: ["local:read"] }
    const res = await post({ name: "Amoxicillin", person_id: 2 })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe(REFUSAL)
    expect(medicationNames()).toEqual([])
  })

  it("refuses it when person_id is missing", async () => {
    sessionUser = { email: "alice@test", id: "local:1", groups: ["local:read"] }
    const res = await post({ name: "Amoxicillin" })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe(REFUSAL)
    expect(medicationNames()).toEqual([])
  })

  it("refuses an inactive or unknown Person, the same as recording a dose for it", async () => {
    sessionUser = { email: "cleo@test", id: "local:4", groups: ["local:read"] }
    for (const person_id of [3, 99]) {
      const res = await post({ name: "Amoxicillin", person_id })
      expect(res.status).toBe(403)
    }
    expect(medicationNames()).toEqual([])
  })

  it("does not reveal an existing catalogue row to a refused caller", async () => {
    testDb.prepare("INSERT INTO medications (name, dosage_unit) VALUES ('Amoxicillin', 'Tabs')").run()
    sessionUser = { email: "alice@test", id: "local:1", groups: ["local:read"] }
    const res = await post({ name: "amoxicillin", person_id: 2 })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe(REFUSAL)
  })

  it("returns the existing row for an allowed caller, with no second row", async () => {
    testDb.prepare("INSERT INTO medications (name, dosage_unit) VALUES ('Amoxicillin', 'Tabs')").run()
    sessionUser = { email: "alice@test", id: "local:1", groups: ["local:read"] }
    const res = await post({ name: "amoxicillin", person_id: 1 })
    expect(res.status).toBe(200)
    expect((await res.json()).name).toBe("Amoxicillin")
    expect(medicationNames()).toEqual(["Amoxicillin"])
  })

  it("still requires a name and a signed-in session", async () => {
    expect((await post({ name: "  " })).status).toBe(400)
    sessionUser = null
    expect((await post({ name: "Amoxicillin" })).status).toBe(401)
  })

  it("records who created the medication and for which Person in the audit entry", async () => {
    sessionUser = { email: "alice@test", id: "local:1", groups: ["local:read"] }
    const res = await post({ name: "Amoxicillin", person_id: 1 })
    const created = await res.json()
    const row = testDb
      .prepare("SELECT user_email, action, entity_type, entity_id, details FROM audit_log WHERE entity_type = 'medications'")
      .get() as { user_email: string; action: string; entity_id: number; details: string }
    expect(row.user_email).toBe("alice@test")
    expect(row.action).toBe("CREATE")
    expect(row.entity_id).toBe(created.id)
    expect(JSON.parse(row.details)).toEqual({ name: "Amoxicillin", person_id: 1 })
  })
})
