import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { applyBaselineSchema } from "@/lib/db"
import type { CalendarContext } from "@/lib/calendar-context"
import { recordDose, type RecordDoseResult } from "@/lib/medication/record-dose"
import { answerDoseTiming, settleSlots } from "@/lib/schedule/slot-outcomes"
import { decideDoseNotification } from "@/lib/push/dose-notification-decision"

const YMD = "2025-01-15"
const at = (hhmm: string) => `${YMD}T${hhmm}:00.000Z`
const calendarFor = (): CalendarContext => ({ ymd: YMD, offsetMinutes: 0, ianaTz: "UTC" })

describe("which doses clear the recorder's reminder", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
    db.pragma("foreign_keys = ON")
    applyBaselineSchema(db)
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    db.prepare("INSERT INTO medications (id, name, default_dosage, dosage_unit) VALUES (1, 'Methylphenidate', 1, 'Tabs')").run()
    db.prepare("INSERT INTO medications (id, name, default_dosage, dosage_unit) VALUES (2, 'Paracetamol', 1, 'Tabs')").run()
    db.prepare(
      `INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_frequency, schedule_tz)
       VALUES (1, 1, 1, ?, ?, 'UTC')`,
    ).run(JSON.stringify(["08:00", "12:00"]), JSON.stringify({ kind: "daily" }))
  })

  afterEach(() => db.close())

  // Cron settles overnight; do the same so only the slots a test provokes go Missed.
  beforeEach(() => {
    settleSlots(db, { nowMs: Date.parse(at("00:00")), calendarFor, notBeforeMs: 0 })
  })

  const dose = (iso: string, medicationId = 1): Extract<RecordDoseResult, { ok: true }> => {
    const r = recordDose(db, {
      personId: 1,
      medicationId,
      recordedAt: iso,
      createdBy: "carer@example.com",
      nowMs: Date.parse(iso),
      calendarFor,
    })
    if (!r.ok) throw new Error(r.error)
    return r
  }
  const decide = (r: { clearsReminder: boolean }, medicationId = 1) =>
    decideDoseNotification({
      personId: 1,
      medicationId,
      clearsReminder: r.clearsReminder,
    })

  const NOTHING = { closeTag: null, replaceOnRecorderDevices: false }

  it("closes the medication reminder for a dose attached to its slot", () => {
    expect(decide(dose(at("08:05")))).toEqual({ closeTag: "medication-reminder-1-1", replaceOnRecorderDevices: true })
  })

  it("does nothing for a dose outside every window that is still waiting for an answer", () => {
    const r = dose(at("10:00"))
    expect(r.timing.kind).toBe("needs_prompt")
    expect(decide(r)).toEqual(NOTHING)
  })

  it("does nothing for an as-needed medication with no schedule", () => {
    expect(decide(dose(at("08:00"), 2))).toEqual(NOTHING)
  })

  it("does nothing for an extra dose inside a window whose slot already has a dose", () => {
    dose(at("08:02"))
    const extra = dose(at("08:06"))
    expect(extra.timing.kind).toBe("extra")
    expect(decide(extra)).toEqual(NOTHING)
  })

  it("closes the reminder when the prompt is answered Late or Early, but not Extra", () => {
    const answer = (recordId: number, a: "late" | "early" | "extra") =>
      answerDoseTiming(db, { recordId, answer: a, nowMs: Date.parse(at("10:30")), calendarFor })
    const late = answer(dose(at("10:00")).recordId, "late")
    const early = answer(dose(at("10:05")).recordId, "early")
    const extra = answer(dose(at("10:10")).recordId, "extra")
    if (!late.ok || !early.ok || !extra.ok) throw new Error("answer failed")
    expect(decide(late).closeTag).toBe("medication-reminder-1-1")
    expect(decide(early).closeTag).toBe("medication-reminder-1-1")
    expect(decide(extra).closeTag).toBeNull()
  })

  it("does not clear the reminder when an unattached dose is what settled an earlier slot as Missed", () => {
    const r = dose(at("12:30"))
    expect(r.clearsReminder).toBe(false)
    expect(r.missedSlots).toHaveLength(1)
    expect(decide(r)).toEqual(NOTHING)
  })

  it("does not clear the reminder for an extra dose even when it settled a slot as Missed", () => {
    dose(at("08:02"))
    const extra = dose(at("12:40"))
    const answered = answerDoseTiming(db, { recordId: extra.recordId, answer: "extra", nowMs: Date.parse(at("12:41")), calendarFor })
    if (!answered.ok) throw new Error("answer failed")
    expect(decide(answered)).toEqual(NOTHING)
  })

  it("ignores a slot that went Missed for a different medication", () => {
    const r = dose(at("12:30"), 2)
    expect(r.missedSlots).toHaveLength(1)
    expect(decide(r, 2)).toEqual(NOTHING)
  })

  it("still closes the reminder for a dose that attached to its slot while settling another as Missed", () => {
    const r = dose(at("12:05"))
    expect(r.clearsReminder).toBe(true)
    expect(decide(r).closeTag).toBe("medication-reminder-1-1")
  })
})
