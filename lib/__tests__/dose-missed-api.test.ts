import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { applyBaselineSchema } from "@/lib/db"

const authorisePersonAccess = vi.fn()

vi.mock("@/lib/auth/auth-helpers", () => ({
  requireAuth: vi.fn(async () => ({
    session: { user: { email: "demo@test", id: "local:1", groups: ["local:read"] } },
    groups: ["local:read"],
  })),
  authorisePersonAccess: (...args: unknown[]) =>
    authorisePersonAccess(...(args as Parameters<typeof authorisePersonAccess>)),
}))

let testDb: Database.Database

vi.mock("@/lib/db", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}))

const PERSON = { id: 1, name: "Pat", account_uid: null, is_active: 1 }

describe("GET /api/dose-missed", () => {
  beforeEach(() => {
    testDb = new Database(":memory:")
    applyBaselineSchema(testDb)
    authorisePersonAccess.mockReturnValue(PERSON)
    testDb.prepare("INSERT INTO people (id, name) VALUES (1, 'Pat')").run()
    testDb.prepare("INSERT INTO medications (id, name) VALUES (1, 'Ritalin')").run()
    testDb.prepare("INSERT INTO person_medications (id, person_id, medication_id, schedule_tz) VALUES (1, 1, 1, 'Africa/Abidjan')").run()
    testDb
      .prepare("INSERT INTO dose_expectations (id, person_medication_id, slot_hhmm, start_date, end_date) VALUES (1, 1, '12:00', '2026-01-01', '2026-12-31')")
      .run()
    const insert = testDb.prepare(
      "INSERT INTO dose_expectation_outcomes (dose_expectation_id, local_ymd, status, slot_at, resolved_at) VALUES (1, ?, ?, ?, ?)",
    )
    // Answered before slot outcomes existed: no slot outcome row, so these still list.
    insert.run("2026-08-01", "confirmed_missed", "2026-08-01T12:00:00.000Z", "2026-08-01T13:00:00.000Z")
    insert.run("2026-08-02", "confirmed_given", "2026-08-02T12:00:00.000Z", "2026-08-02T13:00:00.000Z")
    insert.run("2026-08-03", "snoozed", "2026-08-03T12:00:00.000Z", "2026-08-03T13:00:00.000Z")
    // Answered with slot outcomes in place: the slot outcome row is the one listed, not both.
    insert.run("2026-08-04", "confirmed_missed", "2026-08-04T12:00:00.000Z", "2026-08-04T13:00:00.000Z")
    const slot = testDb.prepare(
      "INSERT INTO slot_outcomes (id, person_medication_id, local_ymd, slot_hhmm, result, missed_cause) VALUES (?, 1, ?, ?, ?, ?)",
    )
    slot.run(10, "2026-08-04", "12:00", "missed", "not_given")
    slot.run(11, "2026-08-05", "08:00", "missed", "timed_out")
    slot.run(12, "2026-08-05", "12:00", "on_time", null)
  })

  afterEach(() => {
    testDb.close()
    vi.clearAllMocks()
  })

  async function get(query: string) {
    const { GET } = await import("@/app/api/dose-missed/route")
    return GET(new NextRequest(`http://localhost/api/dose-missed?${query}`))
  }

  it("lists Missed slots and earlier confirmed misses once each, newest first, placed at the dose time", async () => {
    const res = await get("person_id=1")
    expect(await res.json()).toEqual([
      { id: "slot:11", person_id: 1, medication_name: "Ritalin", recorded_at: "2026-08-05T08:00:00.000Z", cause: "timed_out" },
      { id: "slot:10", person_id: 1, medication_name: "Ritalin", recorded_at: "2026-08-04T12:00:00.000Z", cause: "not_given" },
      { id: "answer:1", person_id: 1, medication_name: "Ritalin", recorded_at: "2026-08-01T12:00:00.000Z", cause: "not_given" },
    ])
  })

  it("filters by the requested date range", async () => {
    const res = await get("person_id=1&from=2026-08-04&to=2026-08-04")
    const rows = (await res.json()) as { id: string }[]
    expect(rows.map(r => r.id)).toEqual(["slot:10"])
  })

  it("narrows to one medication when medication_id is given, for slots and earlier answers alike", async () => {
    testDb.prepare("INSERT INTO medications (id, name) VALUES (2, 'Panadol')").run()
    testDb.prepare("INSERT INTO person_medications (id, person_id, medication_id, schedule_tz) VALUES (2, 1, 2, 'Africa/Abidjan')").run()
    testDb
      .prepare("INSERT INTO dose_expectations (id, person_medication_id, slot_hhmm, start_date, end_date) VALUES (2, 2, '09:00', '2026-01-01', '2026-12-31')")
      .run()
    testDb
      .prepare("INSERT INTO dose_expectation_outcomes (dose_expectation_id, local_ymd, status, slot_at, resolved_at) VALUES (2, '2026-08-06', 'confirmed_missed', '2026-08-06T09:00:00.000Z', '2026-08-06T10:00:00.000Z')")
      .run()
    testDb
      .prepare("INSERT INTO slot_outcomes (id, person_medication_id, local_ymd, slot_hhmm, result, missed_cause) VALUES (20, 2, '2026-08-07', '09:00', 'missed', 'timed_out')")
      .run()
    const panadol = (await (await get("person_id=1&medication_id=2")).json()) as { id: string; medication_name: string }[]
    expect(panadol.map(r => r.id)).toEqual(["slot:20", "answer:5"])
    const ritalin = (await (await get("person_id=1&medication_id=1")).json()) as { id: string }[]
    expect(ritalin.map(r => r.id)).toEqual(["slot:11", "slot:10", "answer:1"])
  })

  it("requires person_id", async () => {
    expect((await get("")).status).toBe(400)
  })
})
