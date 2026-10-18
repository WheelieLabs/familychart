// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { NextRequest, NextResponse } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyBaselineSchema } from "@/lib/db"
import { recordDose } from "@/lib/medication/record-dose"
import { loadSlotOutcomes } from "@/lib/schedule/slot-outcomes"

let testDb: Database.Database

vi.mock("@/lib/db", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}))

let writeAllowed = true
vi.mock("@/lib/auth/auth-helpers", () => ({
  requireAuth: vi.fn(async () => ({
    session: { user: { email: "carer@test", id: "local:1", groups: ["local:carer"] } },
    groups: ["local:carer"],
  })),
  authorisePersonAccess: (db: Database.Database, _ctx: unknown, personId: number) => {
    if (!writeAllowed) return NextResponse.json({ error: "Unauthorised" }, { status: 403 })
    const person = db.prepare("SELECT * FROM people WHERE id = ? AND is_active = 1").get(personId)
    return person ?? NextResponse.json({ error: "Not found" }, { status: 404 })
  },
}))

const DAY = "2025-01-15"
const at = (hhmm: string) => `${DAY}T${hhmm}:00.000Z`

describe("POST /api/records/[id]/timing", () => {
  let recordId: number

  beforeEach(() => {
    writeAllowed = true
    testDb = new Database(":memory:")
    testDb.pragma("foreign_keys = ON")
    applyBaselineSchema(testDb)
    testDb.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    testDb.prepare("INSERT INTO medications (id, name, default_dosage, dosage_unit) VALUES (1, 'Methylphenidate', 1, 'Tabs')").run()
    testDb
      .prepare(
        `INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_frequency, schedule_tz)
         VALUES (1, 1, 1, ?, ?, 'Europe/London')`,
      )
      .run(JSON.stringify(["08:00", "12:00"]), JSON.stringify({ kind: "daily" }))
    const r = recordDose(testDb, { personId: 1, medicationId: 1, recordedAt: at("10:00"), createdBy: "carer@test", nowMs: Date.parse(at("10:00")) })
    if (!r.ok) throw new Error(r.error)
    recordId = r.recordId
  })

  afterEach(() => {
    vi.clearAllMocks()
    testDb.close()
  })

  const post = async (id: string, body: unknown) => {
    const { POST } = await import("@/app/api/records/[id]/timing/route")
    return POST(
      new NextRequest(`http://localhost/api/records/${id}/timing`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id }) },
    )
  }

  it("attaches the dose to the next slot on Early and reports the reminder cleared", async () => {
    const res = await post(String(recordId), { answer: "early" })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ answer: "early", clearsReminder: true, attachedSlot: { slotHhmm: "12:00" } })
    expect(loadSlotOutcomes(testDb, [1], [DAY]).map(o => [o.slotHhmm, o.result])).toContainEqual(["12:00", "early"])
  })

  it("stores nothing on Extra", async () => {
    const res = await post(String(recordId), { answer: "extra" })
    expect(res.status).toBe(200)
    expect(loadSlotOutcomes(testDb, [1], [DAY]).filter(o => o.recordId === recordId)).toEqual([])
  })

  it("rejects an unknown answer and a bad id", async () => {
    expect((await post(String(recordId), { answer: "soon" })).status).toBe(400)
    expect((await post("abc", { answer: "late" })).status).toBe(400)
  })

  it("is 404 for a missing dose and 403 without write access to the person", async () => {
    expect((await post("9999", { answer: "late" })).status).toBe(404)
    writeAllowed = false
    expect((await post(String(recordId), { answer: "late" })).status).toBe(403)
  })

  it("is 409 when the dose is already attached", async () => {
    expect((await post(String(recordId), { answer: "late" })).status).toBe(200)
    expect((await post(String(recordId), { answer: "early" })).status).toBe(409)
  })
})
