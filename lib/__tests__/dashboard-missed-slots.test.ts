import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { CalendarContext } from "@/lib/calendar-context"
import { listDashboardMissedSlots } from "@/lib/dashboard/dashboard-missed-slots"
import { applyBaselineSchema } from "@/lib/db"

// Africa/Abidjan is UTC+0 all year, so SQLite's UTC timestamps are the schedule's local time.
const TZ = "Africa/Abidjan"
const TODAY = "2025-01-15"
const NOW = Date.parse("2025-01-15T15:00:00.000Z")
const calCtx: CalendarContext = { ymd: TODAY, offsetMinutes: 0, ianaTz: TZ }

describe("listDashboardMissedSlots", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
    applyBaselineSchema(db)
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice'), (2, 'Bob')").run()
    db.prepare("INSERT INTO medications (id, name) VALUES (1, 'Ritalin')").run()
    db.prepare(
      "INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_frequency, schedule_tz) VALUES (1, 1, 1, '[]', '{\"kind\":\"daily\"}', ?)",
    ).run(TZ)
    db.prepare(
      "INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_frequency, schedule_tz) VALUES (2, 2, 1, '[]', '{\"kind\":\"daily\"}', ?)",
    ).run(TZ)
  })

  afterEach(() => db.close())

  const missed = (pm: number, ymd: string, hhmm: string, settledAt: string) =>
    db
      .prepare(
        "INSERT INTO slot_outcomes (person_medication_id, local_ymd, slot_hhmm, result, missed_cause, created_at) VALUES (?, ?, ?, 'missed', 'timed_out', ?)",
      )
      .run(pm, ymd, hhmm, settledAt)
  const list = (personId = 1) => listDashboardMissedSlots(db, [1, 2], NOW, calCtx).get(personId) ?? []

  it("lists a slot that became Missed today", () => {
    missed(1, TODAY, "08:00", "2025-01-15 12:00:05")
    expect(list().map(s => [s.medicationName, s.slotHhmm, s.day])).toEqual([["Ritalin", "08:00", "today"]])
  })

  it("keeps yesterday's last slot, which only became Missed when the day ended", () => {
    missed(1, "2025-01-14", "18:00", "2025-01-15 00:00:30")
    expect(list().map(s => [s.slotHhmm, s.day])).toEqual([["18:00", "yesterday"]])
  })

  it("drops a slot that became Missed on an earlier day", () => {
    missed(1, "2025-01-14", "08:00", "2025-01-14 12:00:05")
    expect(list()).toEqual([])
  })

  it("lists each Person's own slots only", () => {
    missed(2, TODAY, "08:00", "2025-01-15 12:00:05")
    expect(list(1)).toEqual([])
    expect(list(2)).toHaveLength(1)
  })
})
