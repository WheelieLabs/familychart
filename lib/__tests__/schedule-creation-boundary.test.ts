// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { evaluateAlertReadiness } from "@/lib/alert-readiness"
import type { CalendarContext } from "@/lib/calendar-context"
import { buildMedicationTimelines } from "@/lib/dashboard/dashboard-medication-timeline"
import { applyBaselineSchema } from "@/lib/db"
import { ianaLocalYmdHmToUtcMs } from "@/lib/datetime"
import type { Person } from "@/lib/domain-types"
import { loadSlotOutcomes, settleSlots } from "@/lib/schedule/slot-outcomes"

// Brisbane is UTC+10 all year (no DST), so a local clock time is never its UTC time.
const TZ = "Australia/Brisbane"
const DAY = "2025-01-15"
const NEXT_DAY = "2025-01-16"
const local = (hhmm: string, ymd = DAY) => ianaLocalYmdHmToUtcMs(ymd, hhmm, TZ)
const person: Person = {
  id: 1, name: "Alice", full_name: null, photo_url: null, color: "#256AA5", sort_order: 0, is_active: 1,
  account_uid: null, date_of_birth: null,
}

describe("a schedule created part-way through the day starts at the next dose", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
    db.pragma("foreign_keys = ON")
    applyBaselineSchema(db)
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    db.prepare("INSERT INTO medications (id, name, default_dosage, dosage_unit) VALUES (1, 'Amoxicillin', 1, 'Tabs')").run()
  })

  afterEach(() => db.close())

  const schedule = (opts: {
    times: string[]
    start: string | null
    createdAt: string | null
    frequency?: object
  }) => {
    db.prepare("DELETE FROM person_medications").run()
    db.prepare(
      `INSERT INTO person_medications
        (id, person_id, medication_id, schedule_times, schedule_frequency, schedule_start_date, schedule_tz, schedule_created_at_ms)
       VALUES (1, 1, 1, ?, ?, ?, ?, ?)`,
    ).run(
      JSON.stringify(opts.times),
      JSON.stringify(opts.frequency ?? { kind: "daily" }),
      opts.start,
      TZ,
      opts.createdAt == null ? null : local(opts.createdAt.split("@")[1]!, opts.createdAt.split("@")[0]!),
    )
  }
  const calCtx = (ymd: string): CalendarContext => ({ ymd, offsetMinutes: -600, ianaTz: TZ })
  const readiness = (nowMs: number) =>
    evaluateAlertReadiness(db, [person], nowMs, calCtx(DAY)).scheduledSlots.map(s => `${s.ymd} ${s.hhmm} ${s.status}`)
  const timelineSlotCount = (nowMs: number) => {
    const lane = buildMedicationTimelines(db, [person], new Date(nowMs), calCtx(DAY)).get(1)![0]
    return lane ? lane.markers.length : 0
  }

  it("raises nothing for an earlier slot the same day (alert readiness)", () => {
    schedule({ times: ["13:30", "20:00"], start: DAY, createdAt: `${DAY}@14:00` })
    expect(readiness(local("14:05"))).toEqual([])
  })

  it("still raises that slot on a schedule with no creation boundary", () => {
    schedule({ times: ["13:30", "20:00"], start: DAY, createdAt: null })
    expect(readiness(local("14:05"))).toEqual([`${DAY} 13:30 overdue_push`])
  })

  it("raises the first upcoming slot as usual", () => {
    schedule({ times: ["13:30", "20:00"], start: DAY, createdAt: `${DAY}@14:00` })
    expect(readiness(local("19:50"))).toEqual([`${DAY} 20:00 upcoming`])
  })

  it("shows no missed or overdue marker for the earlier slot on the timeline", () => {
    schedule({ times: ["08:00", "20:00"], start: DAY, createdAt: `${DAY}@14:00` })
    const withBoundary = timelineSlotCount(local("14:05"))
    schedule({ times: ["08:00", "20:00"], start: DAY, createdAt: null })
    const without = timelineSlotCount(local("14:05"))
    expect(withBoundary).toBeLessThan(without)
  })

  it("never settles the earlier slot as missed", () => {
    schedule({ times: ["08:00", "20:00"], start: DAY, createdAt: `${DAY}@14:00` })
    settleSlots(db, { nowMs: local("00:30", NEXT_DAY), calendarFor: () => calCtx(NEXT_DAY), notBeforeMs: 0 })
    expect(loadSlotOutcomes(db, [1], [DAY]).map(o => [o.slotHhmm, o.result])).toEqual([["20:00", "missed"]])
  })

  it("creates no pending dose-expectation prompt for the earlier slot", () => {
    schedule({ times: ["08:00", "20:00"], start: DAY, createdAt: `${DAY}@14:00` })
    db.prepare(
      `INSERT INTO dose_expectations (person_medication_id, slot_hhmm, start_date, end_date, weekdays, created_by)
       VALUES (1, '08:00', ?, ?, NULL, 'a@example.com')`,
    ).run(DAY, NEXT_DAY)
    expect(
      evaluateAlertReadiness(db, [person], local("14:05"), calCtx(DAY)).pendingDoseExpectations,
    ).toEqual([])
  })

  it("rolls to the next day when created after the last slot", () => {
    schedule({ times: ["08:00", "20:00"], start: DAY, createdAt: `${DAY}@21:00` })
    expect(readiness(local("21:05"))).toEqual([])
    expect(readiness(local("07:50", NEXT_DAY))).toEqual([`${NEXT_DAY} 08:00 upcoming`])
  })

  it("is unchanged when created before the first slot", () => {
    schedule({ times: ["08:00", "20:00"], start: DAY, createdAt: `${DAY}@06:00` })
    expect(readiness(local("08:05"))).toEqual([`${DAY} 08:00 due`])
  })

  it("is unchanged for a schedule created on an earlier day", () => {
    schedule({ times: ["13:30", "20:00"], start: DAY, createdAt: `2025-01-14@10:00` })
    expect(readiness(local("14:05"))).toEqual([`${DAY} 13:30 overdue_push`])
  })

  it("keeps the slots of a start date set before the creation day", () => {
    schedule({ times: ["13:30"], start: "2025-01-14", createdAt: `${DAY}@14:00` })
    settleSlots(db, { nowMs: local("22:00"), calendarFor: () => calCtx(DAY), notBeforeMs: 0 })
    expect(loadSlotOutcomes(db, [1], ["2025-01-14", DAY]).map(o => [o.ymd, o.slotHhmm, o.result])).toEqual([
      ["2025-01-14", "13:30", "missed"],
    ])
  })

  it("leaves a weekday-restricted schedule created on a non-scheduled day unaffected", () => {
    // 2025-01-15 is a Wednesday; the schedule runs Thursdays only.
    schedule({ times: ["08:00"], start: DAY, createdAt: `${DAY}@14:00`, frequency: { kind: "weekly", weekdays: [4] } })
    expect(readiness(local("07:50", NEXT_DAY))).toEqual([`${NEXT_DAY} 08:00 upcoming`])
  })
})
