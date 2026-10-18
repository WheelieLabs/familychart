import Database from "better-sqlite3-multiple-ciphers"
import { NextRequest, NextResponse } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyBaselineSchema } from "@/lib/db"
import { settleSlots } from "@/lib/schedule/slot-outcomes"

let testDb: Database.Database

vi.mock("@/lib/db", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}))

vi.mock("@/lib/auth/auth-helpers", () => ({
  requireAuth: vi.fn(async () => ({
    session: { user: { email: "carer@test", name: "Bec", id: "local:1", groups: ["local:carer"] } },
    groups: ["local:carer"],
  })),
  authorisePersonAccess: (db: Database.Database, _ctx: unknown, personId: number) =>
    db.prepare("SELECT * FROM people WHERE id = ? AND is_active = 1").get(personId) ??
    NextResponse.json({ error: "Not found" }, { status: 404 }),
}))

const selfAck = vi.fn().mockResolvedValue({ sent: 0, errors: [] })
const othersAck = vi.fn().mockResolvedValue(undefined)
vi.mock("@/lib/push", () => ({
  sendMedicationAcknowledgementPushes: (...args: unknown[]) => othersAck(...args),
  sendSelfDoseAcknowledgementPushes: (...args: unknown[]) => selfAck(...args),
}))

const NOW = Date.parse("2025-01-15T11:00:00.000Z")

describe("POST /api/records: self notification", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(NOW)
    testDb = new Database(":memory:")
    testDb.pragma("foreign_keys = ON")
    applyBaselineSchema(testDb)
    testDb.prepare("INSERT INTO people (id, name) VALUES (1, 'Toby')").run()
    testDb.prepare("INSERT INTO medications (id, name, default_dosage, dosage_unit) VALUES (1, 'Panadol', 1, 'Tabs')").run()
    testDb.prepare("INSERT INTO medications (id, name, default_dosage, dosage_unit) VALUES (2, 'Ibuprofen', 1, 'Tabs')").run()
    testDb
      .prepare(
        `INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_frequency, schedule_tz)
         VALUES (1, 1, 1, ?, ?, 'Europe/London')`,
      )
      .run(JSON.stringify(["08:00", "12:00"]), JSON.stringify({ kind: "daily" }))
    // Cron settles overnight; do the same so only slots a test provokes go Missed.
    settleSlots(testDb, {
      nowMs: Date.parse("2025-01-15T00:00:00.000Z"),
      notBeforeMs: 0,
      calendarFor: () => ({ ymd: "2025-01-15", offsetMinutes: 0, ianaTz: "Europe/London" }),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    testDb.close()
  })

  const post = async (medicationId: number, recordedAt: string, headers: Record<string, string> = {}) => {
    const { POST } = await import("@/app/api/records/route")
    const res = await POST(
      new NextRequest("http://localhost/api/records", {
        method: "POST",
        body: JSON.stringify({ person_id: 1, medication_id: medicationId, recorded_at: recordedAt, dosage: 1, dosage_unit: "Tabs" }),
        headers: { "content-type": "application/json", ...headers },
      }),
    )
    return { status: res.status, body: (await res.json()) as { closeNotificationTag: string | null } }
  }

  it("tells the recording device to close the reminder and pushes 'You gave' to its other devices", async () => {
    const { status, body } = await post(1, "2025-01-15T08:05:00.000Z", { "x-fc-push-endpoint": "https://push.example/phone" })
    expect(status).toBe(201)
    expect(body.closeNotificationTag).toBe("medication-reminder-1-1")
    expect(selfAck).toHaveBeenCalledTimes(1)
    expect(selfAck.mock.calls[0]![1]).toMatchObject({
      personId: 1,
      medicationId: 1,
      recordingEndpoint: "https://push.example/phone",
      personName: "Toby",
      medicationName: "Panadol",
    })
    // Other Accounts still get the "<name> gave" acknowledgement.
    expect(othersAck).toHaveBeenCalledTimes(1)
  })

  it("leaves the reminder alone for an as-needed dose", async () => {
    const { body } = await post(2, "2025-01-15T08:05:00.000Z")
    expect(body.closeNotificationTag).toBeNull()
    expect(selfAck).not.toHaveBeenCalled()
    expect(othersAck).toHaveBeenCalledTimes(1)
  })

  it("leaves the reminder alone for a scheduled dose still waiting for its prompt", async () => {
    const { body } = await post(1, "2025-01-15T10:00:00.000Z")
    expect(body.closeNotificationTag).toBeNull()
    expect(selfAck).not.toHaveBeenCalled()
  })

  it("ignores a recording-device header that is not an https URL", async () => {
    await post(1, "2025-01-15T08:05:00.000Z", { "x-fc-push-endpoint": "javascript:alert(1)" })
    expect(selfAck.mock.calls[0]![1]).toMatchObject({ recordingEndpoint: null })
  })
})
