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

async function putPerson(id: number, body: Record<string, unknown>) {
  const { PUT } = await import("@/app/api/people/[id]/route")
  return PUT(new NextRequest(`http://localhost/api/people/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: String(id) }) })
}

async function postPerson(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/people/route")
  return POST(new NextRequest("http://localhost/api/people", {
    method: "POST",
    body: JSON.stringify(body),
  }))
}

async function exportStatus(personId: number) {
  const { GET } = await import("@/app/api/people/[id]/export/route")
  const res = await GET(new NextRequest(`http://localhost/api/people/${personId}/export`), {
    params: Promise.resolve({ id: String(personId) }),
  })
  if (res.body && !res.body.locked) await res.body.cancel()
  return res.status
}

async function eraseStatus(personId: number) {
  const { POST } = await import("@/app/api/people/[id]/erase/route")
  const res = await POST(new NextRequest(`http://localhost/api/people/${personId}/erase`, {
    method: "POST",
    body: JSON.stringify({}),
  }), { params: Promise.resolve({ id: String(personId) }) })
  return res.status
}

const accountUid = (id: number) =>
  (testDb.prepare("SELECT account_uid FROM people WHERE id = ?").get(id) as { account_uid: string | null }).account_uid

describe("Personal-link writes are Admin only", () => {
  beforeEach(async () => {
    testDb = new Database(":memory:")
    testDb.pragma("foreign_keys = ON")
    applyBaselineSchema(testDb)
    await seedExportHousehold(testDb)
  })

  afterEach(() => {
    testDb.close()
    vi.clearAllMocks()
  })

  it("refuses a Manager linking another household member's Person to their own Account, and grants no export or erase", async () => {
    signInAs(3, "manager@example.com")
    expect(await exportStatus(1)).toBe(404)
    expect(await eraseStatus(1)).toBe(404)

    const res = await putPerson(1, { account_uid: "local:3" })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/^Unauthorised/)
    expect(accountUid(1)).toBeNull()

    expect(await exportStatus(1)).toBe(404)
    expect(await eraseStatus(1)).toBe(404)
    expect(testDb.prepare("SELECT id FROM people WHERE id = 1").get()).toEqual({ id: 1 })
  })

  it("refuses a Manager moving or clearing an existing link", async () => {
    signInAs(3, "manager@example.com")
    expect((await putPerson(2, { account_uid: "local:3" })).status).toBe(403)
    expect((await putPerson(2, { account_uid: null })).status).toBe(403)
    expect(accountUid(2)).toBe("local:2")
  })

  it("refuses a Manager creating a Person with a link", async () => {
    signInAs(3, "manager@example.com")
    const res = await postPerson({ name: "Newbie", account_uid: "local:3" })
    expect(res.status).toBe(403)
    expect(testDb.prepare("SELECT id FROM people WHERE name = 'Newbie'").get()).toBeUndefined()
  })

  it("lets a Manager edit other fields, with the link echoed back unchanged or absent", async () => {
    signInAs(3, "manager@example.com")
    expect((await putPerson(2, { name: "Samantha", account_uid: "local:2" })).status).toBe(200)
    expect((await putPerson(1, { name: "Alexander", account_uid: null })).status).toBe(200)
    expect((await putPerson(1, { color: "#123456" })).status).toBe(200)
    expect(testDb.prepare("SELECT name FROM people WHERE id = 2").get()).toEqual({ name: "Samantha" })
    expect(accountUid(2)).toBe("local:2")
  })

  it("lets a Manager create a Person without a link", async () => {
    signInAs(3, "manager@example.com")
    expect((await postPerson({ name: "Newbie" })).status).toBe(201)
    expect((await postPerson({ name: "Other", account_uid: "" })).status).toBe(201)
  })

  it("lets an Admin set, move and clear links, and create a linked Person", async () => {
    signInAs(1, "admin@example.com")
    expect((await putPerson(1, { account_uid: "local:3" })).status).toBe(200)
    expect(accountUid(1)).toBe("local:3")
    expect((await putPerson(1, { account_uid: "local:4" })).status).toBe(200)
    expect((await putPerson(1, { account_uid: null })).status).toBe(200)
    expect(accountUid(1)).toBeNull()
    expect((await postPerson({ name: "Linked", account_uid: "local:5" })).status).toBe(201)
  })
})
