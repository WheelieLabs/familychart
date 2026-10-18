// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { NextRequest, NextResponse } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyBaselineSchema } from "@/lib/db"

let testDb: Database.Database

vi.mock("@/lib/db", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}))

vi.mock("@/lib/auth/auth-helpers", () => ({
  requireAuth: vi.fn(async () => ({
    session: { user: { email: "carer@test", id: "local:1", groups: ["local:carer"] } },
    groups: ["local:carer"],
  })),
  requireRead: vi.fn(async () => ({
    session: { user: { email: "carer@test", id: "local:1", groups: ["local:carer"] } },
    groups: ["local:carer"],
  })),
  authorisePersonAccess: (db: Database.Database, _ctx: unknown, personId: number) =>
    db.prepare("SELECT * FROM people WHERE id = ? AND is_active = 1").get(personId) ??
    NextResponse.json({ error: "Not found" }, { status: 404 }),
}))

const T1 = 1_700_000_000_000
const T2 = T1 + 3_600_000
const params = { params: Promise.resolve({ id: "1" }) }

describe("person-medications schedule creation boundary", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(T1)
    testDb = new Database(":memory:")
    testDb.pragma("foreign_keys = ON")
    applyBaselineSchema(testDb)
    testDb.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    testDb.prepare("INSERT INTO medications (id, name, default_dosage, dosage_unit) VALUES (1, 'Amoxicillin', 1, 'Tabs')").run()
  })

  afterEach(() => {
    vi.useRealTimers()
    testDb.close()
  })

  const stamp = () =>
    (
      testDb
        .prepare("SELECT schedule_created_at_ms AS ms FROM person_medications WHERE person_id = 1 AND medication_id = 1")
        .get() as { ms: number | null } | undefined
    )?.ms
  const post = async (body: object) => {
    const { POST } = await import("@/app/api/people/[id]/person-medications/route")
    return POST(
      new NextRequest("http://localhost/api/people/1/person-medications", {
        method: "POST",
        body: JSON.stringify({ medication_id: 1, tz: "Europe/London", ...body }),
        headers: { "content-type": "application/json" },
      }),
      params,
    )
  }
  const patch = async (id: number, body: object) => {
    const { PATCH } = await import("@/app/api/people/[id]/person-medications/route")
    return PATCH(
      new NextRequest(`http://localhost/api/people/1/person-medications?id=${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
      params,
    )
  }
  const daily = { schedule_times: ["08:00", "20:00"], schedule_frequency: { kind: "daily" }, schedule_start_date: "2025-01-15" }

  it("stamps the boundary when POST creates a running schedule", async () => {
    const res = await post(daily); expect(await res.json()).not.toHaveProperty("error"); expect(res.status).toBe(201)
    expect(stamp()).toBe(T1)
  })

  it("keeps the boundary when POST re-sends an already running schedule", async () => {
    await post(daily)
    vi.setSystemTime(T2)
    await post({ ...daily, schedule_times: ["09:00", "21:00"] })
    expect(stamp()).toBe(T1)
  })

  it("stamps the boundary when POST starts a schedule on an assignment that had none", async () => {
    await post({})
    expect(stamp()).toBeNull()
    vi.setSystemTime(T2)
    await post(daily)
    expect(stamp()).toBe(T2)
  })

  it("stamps the boundary when POST re-activates a deactivated assignment", async () => {
    await post(daily)
    testDb.prepare("UPDATE person_medications SET is_active = 0").run()
    vi.setSystemTime(T2)
    await post(daily)
    expect(stamp()).toBe(T2)
  })

  it("clears the boundary when POST re-sends an assignment with no times", async () => {
    await post(daily)
    await post({})
    expect(stamp()).toBeNull()
  })

  it("PATCH keeps the boundary on an edit and stamps it when a schedule starts", async () => {
    await post(daily)
    const id = (testDb.prepare("SELECT id FROM person_medications").get() as { id: number }).id
    vi.setSystemTime(T2)
    expect((await patch(id, { schedule_times: ["10:00"] })).status).toBe(200)
    expect(stamp()).toBe(T1)
    await patch(id, { is_active: 0 })
    expect(stamp()).toBeNull()
    vi.setSystemTime(T2 + 1000)
    await patch(id, { is_active: 1 })
    expect(stamp()).toBe(T2 + 1000)
  })
})
