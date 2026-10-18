import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { CalendarContext } from "@/lib/calendar-context"
import { buildMedicationTimelines } from "@/lib/dashboard/dashboard-medication-timeline"
import { applyBaselineSchema } from "@/lib/db"
import type { Person } from "@/lib/domain-types"

// Africa/Abidjan is UTC+0 all year, so slot times read the same in UTC.
const TZ = "Africa/Abidjan"
const YMD = "2025-01-15"
const at = (hhmm: string) => `${YMD}T${hhmm}:00.000Z`
const NOW = new Date(at("15:00"))
const calCtx: CalendarContext = { ymd: YMD, offsetMinutes: 0, ianaTz: TZ }
const person: Person = {
  id: 1, name: "Alice", full_name: null, photo_url: null, color: "#256AA5", sort_order: 0, is_active: 1,
  account_uid: null, date_of_birth: null,
}

describe("buildMedicationTimelines — timing from stored slot outcomes", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
    db.pragma("foreign_keys = ON")
    applyBaselineSchema(db)
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    db.prepare("INSERT INTO medications (id, name, default_dosage, dosage_unit) VALUES (1, 'Ritalin', 1, 'Tabs')").run()
    db.prepare(
      `INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_frequency, schedule_tz)
       VALUES (1, 1, 1, ?, ?, ?)`,
    ).run(JSON.stringify(["08:00", "10:00", "12:00", "18:00"]), JSON.stringify({ kind: "daily" }), TZ)
  })

  afterEach(() => db.close())

  const record = (iso: string): number =>
    Number(
      db.prepare("INSERT INTO medication_records (person_id, medication_id, recorded_at, dosage) VALUES (1, 1, ?, 1)").run(iso)
        .lastInsertRowid,
    )
  const outcome = (hhmm: string, result: string, offset: number | null, recordId: number | null, cause: string | null = null) =>
    db
      .prepare(
        `INSERT INTO slot_outcomes (person_medication_id, local_ymd, slot_hhmm, result, offset_minutes, missed_cause, medication_record_id)
         VALUES (1, ?, ?, ?, ?, ?, ?)`,
      )
      .run(YMD, hhmm, result, offset, cause, recordId)
  const lane = () => buildMedicationTimelines(db, [person], NOW, calCtx).get(1)![0]!

  it("marks each dose by the timing stored when it was saved", () => {
    outcome("08:00", "on_time", 4, record(at("08:04")))
    outcome("12:00", "late", 41, record(at("12:41")))
    const taken = lane().markers.filter(m => m.kind === "taken")
    expect(taken.map(m => (m.kind === "taken" ? [m.timing, m.flag?.label ?? null] : null))).toEqual([
      ["on_time", null],
      ["late", "41 min late"],
    ])
  })

  it("shows a Missed slot as a cross and leaves a slot a dose attached to unmarked", () => {
    outcome("08:00", "on_time", 4, record(at("08:04")))
    outcome("10:00", "missed", null, null, "timed_out")
    const markers = lane().markers
    expect(markers.filter(m => m.kind === "missed").map(m => m.atIso)).toEqual([at("10:00")])
    expect(markers.filter(m => m.kind === "overdue").map(m => m.atIso)).toContain(at("12:00"))
    expect(markers.filter(m => m.kind === "overdue").map(m => m.atIso)).not.toContain(at("08:00"))
    expect(markers.filter(m => m.kind === "upcoming").map(m => m.atIso)).toEqual([at("18:00")])
  })

  it("draws a dotted line at every slot time, whatever became of it", () => {
    outcome("08:00", "on_time", 4, record(at("08:04")))
    expect(lane().slotLines).toContain(at("08:00"))
    expect(lane().slotLines).toContain(at("18:00"))
  })

  it("does not pair a dose to a slot just because it is close: an unattached dose has no timing", () => {
    record(at("11:30"))
    const taken = lane().markers.find(m => m.kind === "taken")
    expect(taken).toMatchObject({ kind: "taken", timing: null, flag: null })
  })
})
