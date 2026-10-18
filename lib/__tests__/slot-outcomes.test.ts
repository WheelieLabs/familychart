import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { applyBaselineSchema } from "@/lib/db"
import type { CalendarContext } from "@/lib/calendar-context"
import { recordDose, type RecordDoseResult } from "@/lib/medication/record-dose"
import { resolveDoseExpectation } from "@/lib/schedule/dose-expectation-resolve"
import { answerDoseTiming, loadSlotOutcomes, settleSlots } from "@/lib/schedule/slot-outcomes"

const YMD = "2025-01-15"
const NEXT_YMD = "2025-01-16"
const at = (hhmm: string, ymd = YMD) => `${ymd}T${hhmm}:00.000Z`
const calendarFor = (): CalendarContext => ({ ymd: YMD, offsetMinutes: 0, ianaTz: "UTC" })

describe("slot outcomes", () => {
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
    ).run(JSON.stringify(["08:00", "12:00", "18:00"]), JSON.stringify({ kind: "daily" }))
  })

  afterEach(() => db.close())

  const dose = (iso: string, over: { medicationId?: number } = {}): Extract<RecordDoseResult, { ok: true }> => {
    const r = recordDose(db, {
      personId: 1,
      medicationId: over.medicationId ?? 1,
      recordedAt: iso,
      createdBy: "carer@example.com",
      nowMs: Date.parse(iso),
      calendarFor,
    })
    if (!r.ok) throw new Error(r.error)
    return r
  }
  const outcomes = () => loadSlotOutcomes(db, [1], [YMD, NEXT_YMD])
  const attached = () => outcomes().filter(o => o.recordId != null)
  const answer = (recordId: number, a: "late" | "early" | "extra") =>
    answerDoseTiming(db, { recordId, answer: a, nowMs: Date.parse(at("20:00")), calendarFor })
  const r2pm = () => (db.prepare("SELECT id FROM person_medications WHERE medication_id = 2").get() as { id: number }).id
  const settle = (iso: string) => settleSlots(db, { nowMs: Date.parse(iso), calendarFor, notBeforeMs: Date.parse(at("00:00")) })

  it("attaches silently as On time at both edges of the window", () => {
    const early = dose(at("07:50"))
    const late = dose(at("12:10"))
    expect(early.timing).toMatchObject({ kind: "on_time", slotHhmm: "08:00" })
    expect(late.timing).toMatchObject({ kind: "on_time", slotHhmm: "12:00" })
    expect(outcomes().map(o => [o.slotHhmm, o.result, o.recordId])).toEqual([
      ["08:00", "on_time", early.recordId],
      ["12:00", "on_time", late.recordId],
    ])
  })

  it("asks for a prompt one minute outside the window and stores nothing until answered", () => {
    const r = dose(at("12:11"))
    expect(r.timing).toMatchObject({ kind: "needs_prompt", previousSlot: "12:00", nextSlot: "18:00" })
    expect(attached()).toEqual([])
  })

  it("Late attaches to the previous slot", () => {
    const r = dose(at("09:00"))
    expect(r.timing).toMatchObject({ kind: "needs_prompt", previousSlot: "08:00", nextSlot: "12:00" })
    expect(answer(r.recordId, "late")).toMatchObject({ ok: true, clearsReminder: true })
    expect(outcomes()).toEqual([
      expect.objectContaining({ slotHhmm: "08:00", result: "late", offsetMinutes: 60, recordId: r.recordId }),
    ])
  })

  it("Early attaches to the next slot and marks every earlier open slot Missed straight away", () => {
    const r = dose(at("17:00"))
    expect(answer(r.recordId, "early")).toMatchObject({ ok: true, clearsReminder: true })
    expect(outcomes().map(o => [o.slotHhmm, o.result, o.offsetMinutes])).toEqual([
      ["08:00", "missed", null],
      ["12:00", "missed", null],
      ["18:00", "early", -60],
    ])
    expect(outcomes().map(o => o.missedCause)).toEqual(["timed_out", "early_answer", null])
  })

  it("Extra, and no answer at all, leave the slots alone", () => {
    const r = dose(at("09:00"))
    expect(answer(r.recordId, "extra")).toMatchObject({ ok: true, clearsReminder: false })
    expect(attached()).toEqual([])
    dose(at("15:00"))
    expect(attached()).toEqual([])
  })

  it("does not offer Late for a previous slot that already has a dose", () => {
    dose(at("08:00"))
    const r = dose(at("09:00"))
    expect(r.timing).toMatchObject({ kind: "needs_prompt", previousSlot: null, nextSlot: "12:00" })
  })

  it("treats a second dose inside an already-attached window as extra with no prompt", () => {
    dose(at("08:00"))
    expect(dose(at("08:05")).timing).toEqual({ kind: "extra" })
    expect(outcomes()).toHaveLength(1)
  })

  it("rejects answering a dose that is already attached", () => {
    const r = dose(at("08:00"))
    expect(answer(r.recordId, "late")).toMatchObject({ ok: false, status: 409 })
  })

  it("never classifies an unscheduled medication", () => {
    const r = dose(at("09:00"), { medicationId: 2 })
    expect(r.timing).toEqual({ kind: "unscheduled" })
    expect(settle(at("01:00", NEXT_YMD)).missed.filter(m => m.personMedicationId === r2pm())).toEqual([])
    expect(loadSlotOutcomes(db, [r2pm()], [YMD])).toEqual([])
  })

  it("marks a slot Missed when the next slot starts, and the last slot when its day ends", () => {
    expect(settle(at("11:59")).missed).toEqual([])
    expect(settle(at("12:00")).missed).toEqual([{ personMedicationId: 1, ymd: YMD, slotHhmm: "08:00" }])
    expect(outcomes().map(o => [o.slotHhmm, o.result, o.missedCause])).toEqual([["08:00", "missed", "timed_out"]])
    settle(at("23:59"))
    expect(outcomes().map(o => o.slotHhmm)).toEqual(["08:00", "12:00"])
    settle(at("00:00", NEXT_YMD))
    expect(outcomes().map(o => [o.slotHhmm, o.result])).toEqual([
      ["08:00", "missed"],
      ["12:00", "missed"],
      ["18:00", "missed"],
    ])
  })

  it("settling twice, or over a slot with a dose, changes nothing", () => {
    dose(at("08:00"))
    settle(at("23:00"))
    expect(settle(at("23:30")).missed).toEqual([])
    expect(outcomes().map(o => [o.slotHhmm, o.result])).toEqual([
      ["08:00", "on_time"],
      ["12:00", "missed"],
    ])
  })

  it("ignores slots before notBeforeMs", () => {
    const r = settleSlots(db, { nowMs: Date.parse(at("23:00")), calendarFor, notBeforeMs: Date.parse(at("11:00")) })
    expect(r.missed.map(m => m.slotHhmm)).toEqual(["12:00"])
  })

  it("keeps labels when the schedule is edited later", () => {
    const r = dose(at("09:00"))
    answer(r.recordId, "late")
    db.prepare("UPDATE person_medications SET schedule_times = ? WHERE id = 1").run(JSON.stringify(["09:00"]))
    settle(at("23:00"))
    expect(outcomes().find(o => o.slotHhmm === "08:00")).toMatchObject({ result: "late", recordId: r.recordId })
  })

  it("still lets a dose be recorded and attached after a slot is Missed", () => {
    settle(at("13:00"))
    const r = dose(at("13:30"))
    expect(r.timing).toMatchObject({ kind: "needs_prompt", previousSlot: "12:00" })
    answer(r.recordId, "late")
    expect(outcomes().find(o => o.slotHhmm === "12:00")).toMatchObject({ result: "late", recordId: r.recordId })
  })

  it("frees the slot when the attached dose is deleted", () => {
    const r = dose(at("08:00"))
    db.prepare("DELETE FROM medication_records WHERE id = ?").run(r.recordId)
    expect(attached()).toEqual([])
  })

  describe("dose expectations", () => {
    beforeEach(() => {
      db.prepare(
        `INSERT INTO dose_expectations (id, person_medication_id, slot_hhmm, start_date, end_date)
         VALUES (1, 1, '12:00', '2025-01-13', '2025-03-28')`,
      ).run()
    })
    const resolve = (outcome: "given" | "missed") =>
      resolveDoseExpectation(db, {
        expectationId: 1,
        ymd: YMD,
        outcome,
        nowMs: Date.parse(at("12:40")),
        resolveCalendar: calendarFor,
        actor: "parent@example.com",
      })

    it("never times the slot out", () => {
      settle(at("05:00", NEXT_YMD))
      expect(outcomes().map(o => o.slotHhmm)).toEqual(["08:00", "18:00"])
    })

    it("Given attaches the dose with no timing label", () => {
      expect(resolve("given").ok).toBe(true)
      const record = db.prepare("SELECT id FROM medication_records").get() as { id: number }
      expect(outcomes()).toEqual([
        expect.objectContaining({ slotHhmm: "12:00", result: "given", recordId: record.id, offsetMinutes: null }),
      ])
    })

    it("Not given makes the slot Missed immediately", () => {
      expect(resolve("missed").ok).toBe(true)
      expect(outcomes()).toEqual([
        expect.objectContaining({ slotHhmm: "12:00", result: "missed", recordId: null, missedCause: "not_given" }),
      ])
    })

    it("a manual dose follows the usual rules and attaches to the slot", () => {
      expect(dose(at("12:05")).timing).toMatchObject({ kind: "on_time", slotHhmm: "12:00" })
      expect(attached()).toEqual([expect.objectContaining({ slotHhmm: "12:00", result: "on_time" })])
    })

    it("a late answer for the expectation slot attaches it", () => {
      const r = dose(at("14:00"))
      expect(r.timing).toMatchObject({ kind: "needs_prompt", previousSlot: "12:00", nextSlot: "18:00" })
      answer(r.recordId, "late")
      expect(attached()).toEqual([expect.objectContaining({ slotHhmm: "12:00", result: "late" })])
    })
  })
})
