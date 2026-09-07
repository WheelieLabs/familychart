import Database from "better-sqlite3-multiple-ciphers"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { SETTING_LOCALE_DEFAULT_TIMEZONE } from "@/lib/settings/registry"
import { serverAuthoritativeLocalYmd } from "@/lib/calendar-context"
import { trySuppressNextScheduleSlot } from "@/lib/schedule/schedule-reminder-suppression"

const ENV_KEY = "FC_DEFAULT_TIMEZONE"

/** Fixed server instant: 2024-06-15 02:00 UTC → 2024-06-15 12:00 in Australia/Sydney (UTC+10). */
const SERVER_NOW_MS = Date.UTC(2024, 5, 15, 2, 0, 0)

function createTestDb(instanceTz?: string): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE app_settings (
      key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (key)
    );
    CREATE TABLE schedule_reminder_suppressions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_medication_id INTEGER NOT NULL,
      local_ymd TEXT NOT NULL,
      slot_hhmm TEXT NOT NULL,
      medication_record_id INTEGER,
      created_by TEXT,
      UNIQUE (person_medication_id, local_ymd, slot_hhmm)
    );
  `)
  if (instanceTz) {
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_LOCALE_DEFAULT_TIMEZONE,
      instanceTz,
      Date.now(),
    )
  }
  return db
}

function makeRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/records", { headers })
}

function countSuppressions(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM schedule_reminder_suppressions").get() as { n: number }).n
}

function suppressionYmds(db: Database.Database): string[] {
  return (
    db.prepare("SELECT local_ymd FROM schedule_reminder_suppressions ORDER BY local_ymd").all() as {
      local_ymd: string
    }[]
  ).map((r) => r.local_ymd)
}

const pmBase = {
  id: 1,
  schedule_times: JSON.stringify(["08:00", "20:00"]),
  schedule_frequency: JSON.stringify({ kind: "daily" }),
  schedule_start_date: "2024-01-01",
  schedule_end_date: null as string | null,
  schedule_tz: "Australia/Sydney" as string | null,
}

describe("trySuppressNextScheduleSlot", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    delete process.env[ENV_KEY]
  })

  afterEach(() => {
    delete process.env[ENV_KEY]
    db?.close()
  })

  it("inserts a same-day suppression with an honest client clock", () => {
    // Dose at 10:00 Sydney (00:00 UTC) — next slot is 20:00 same day
    const recordedAtMs = Date.UTC(2024, 5, 15, 0, 0, 0)
    const req = makeRequest({
      "x-fc-client-now": new Date(SERVER_NOW_MS).toISOString(),
    })

    const inserted = trySuppressNextScheduleSlot(db, {
      personMedication: pmBase,
      recordedAtMs,
      recordId: 42,
      createdBy: "writer@test",
      request: req,
      serverNowMs: SERVER_NOW_MS,
    })

    expect(inserted).toBe(true)
    expect(suppressionYmds(db)).toEqual(["2024-06-15"])
    const row = db
      .prepare(
        "SELECT slot_hhmm, medication_record_id FROM schedule_reminder_suppressions WHERE person_medication_id = 1",
      )
      .get() as { slot_hhmm: string; medication_record_id: number }
    expect(row.slot_hhmm).toBe("20:00")
    expect(row.medication_record_id).toBe(42)
  })

  it("does not insert a future-day suppression when x-fc-client-now is forged ahead", () => {
    const recordedAtMs = Date.UTC(2024, 5, 15, 0, 0, 0)
    // Forged to 2024-06-20 12:00 Sydney (02:00 UTC)
    const forgedClientNow = Date.UTC(2024, 5, 20, 2, 0, 0)
    const req = makeRequest({
      "x-fc-client-now": new Date(forgedClientNow).toISOString(),
    })

    const inserted = trySuppressNextScheduleSlot(db, {
      personMedication: pmBase,
      recordedAtMs,
      recordId: 42,
      createdBy: "writer@test",
      request: req,
      serverNowMs: SERVER_NOW_MS,
    })

    expect(inserted).toBe(false)
    expect(countSuppressions(db)).toBe(0)
  })

  it("does not plant a future suppression via forged x-fc-local-today without IANA", () => {
    const recordedAtMs = Date.UTC(2024, 5, 15, 2, 0, 0)
    const req = makeRequest({
      "x-fc-client-now": new Date(SERVER_NOW_MS).toISOString(),
      "x-fc-local-today": "2024-06-20",
      "x-fc-tz-offset": "0",
    })

    const inserted = trySuppressNextScheduleSlot(db, {
      personMedication: { ...pmBase, schedule_tz: null },
      recordedAtMs,
      recordId: 42,
      createdBy: "writer@test",
      request: req,
      serverNowMs: SERVER_NOW_MS,
    })

    expect(inserted).toBe(false)
    expect(countSuppressions(db)).toBe(0)
  })

  it("still inserts when client headers agree with server-local today (no IANA)", () => {
    const serverYmd = serverAuthoritativeLocalYmd(db, null, SERVER_NOW_MS)
    // Pick a recorded_at earlier on that civil day so a later slot remains
    const recordedAtMs = SERVER_NOW_MS - 2 * 60 * 60_000
    const req = makeRequest({
      "x-fc-client-now": new Date(SERVER_NOW_MS).toISOString(),
      "x-fc-local-today": serverYmd,
      "x-fc-tz-offset": String(new Date(SERVER_NOW_MS).getTimezoneOffset()),
    })

    const inserted = trySuppressNextScheduleSlot(db, {
      personMedication: {
        ...pmBase,
        schedule_tz: null,
        // Use slots that are late in the day so "earlier today" always finds a next slot
        schedule_times: JSON.stringify(["23:00"]),
      },
      recordedAtMs,
      recordId: 7,
      createdBy: "writer@test",
      request: req,
      serverNowMs: SERVER_NOW_MS,
    })

    expect(inserted).toBe(true)
    expect(suppressionYmds(db)).toEqual([serverYmd])
  })

  it("does not insert when recorded_at is on the previous local day", () => {
    // Yesterday 12:00 Sydney (02:00 UTC 14 Jun) — before every 15 Jun slot
    const recordedAtMs = Date.UTC(2024, 5, 14, 2, 0, 0)
    const req = makeRequest({
      "x-fc-client-now": new Date(SERVER_NOW_MS).toISOString(),
    })

    const inserted = trySuppressNextScheduleSlot(db, {
      personMedication: pmBase,
      recordedAtMs,
      recordId: 42,
      createdBy: "writer@test",
      request: req,
      serverNowMs: SERVER_NOW_MS,
    })

    expect(inserted).toBe(false)
    expect(countSuppressions(db)).toBe(0)
  })
})
