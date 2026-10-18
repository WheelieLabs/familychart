import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { applyBaselineSchema } from "@/lib/db"
import { resolveDoseExpectation, SNOOZE_MS } from "@/lib/schedule/dose-expectation-resolve"
import type { CalendarContext } from "@/lib/calendar-context"

const UTC: CalendarContext = { ymd: "2025-01-15", offsetMinutes: 0, ianaTz: "UTC" }
const NOW = Date.parse("2025-01-15T12:40:00.000Z")
const YMD = "2025-01-15"

describe("resolveDoseExpectation", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
    applyBaselineSchema(db)
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    db.prepare("INSERT INTO medications (id, name, default_dosage, dosage_unit) VALUES (1, 'Methylphenidate', 1, 'Tabs')").run()
    db.prepare(
      `INSERT INTO person_medications (id, person_id, medication_id, schedule_times, schedule_slots, schedule_frequency, schedule_tz)
       VALUES (1, 1, 1, ?, ?, ?, 'UTC')`,
    ).run(
      JSON.stringify(["08:00", "12:00"]),
      JSON.stringify([{ time: "08:00", dosage: 1 }, { time: "12:00", dosage: 2 }]),
      JSON.stringify({ kind: "daily" }),
    )
    db.prepare(
      `INSERT INTO dose_expectations (id, person_medication_id, slot_hhmm, start_date, end_date)
       VALUES (1, 1, '12:00', '2025-01-13', '2025-03-28')`,
    ).run()
  })

  afterEach(() => db.close())

  const resolve = (outcome: "given" | "missed" | "not_yet", over: { ymd?: string; expectationId?: number; nowMs?: number } = {}) =>
    resolveDoseExpectation(db, {
      expectationId: over.expectationId ?? 1,
      ymd: over.ymd ?? YMD,
      outcome,
      nowMs: over.nowMs ?? NOW,
      // "Today" in the schedule's timezone follows the supplied clock.
      resolveCalendar: () => ({ ...UTC, ymd: new Date(over.nowMs ?? NOW).toISOString().slice(0, 10) }),
      actor: "parent@example.com",
    })

  it("'given' records a real dose at the slot time, tagged away from home, with the slot's dosage", () => {
    const result = resolve("given")
    expect(result.ok).toBe(true)

    const record = db.prepare("SELECT * FROM medication_records").get() as Record<string, unknown>
    expect(record).toEqual(
      expect.objectContaining({
        person_id: 1,
        medication_id: 1,
        recorded_at: "2025-01-15T12:00:00.000Z",
        dosage: 2,
        dosage_unit: "Tabs",
        administered_by: "away_from_home",
        created_by: "parent@example.com",
      }),
    )
    expect(db.prepare("SELECT status, medication_record_id FROM dose_expectation_outcomes").get()).toEqual({
      status: "confirmed_given",
      medication_record_id: (record as { id: number }).id,
    })
  })

  it("'missed' stores history only — no dose record", () => {
    expect(resolve("missed").ok).toBe(true)
    expect(db.prepare("SELECT COUNT(*) AS n FROM medication_records").get()).toEqual({ n: 0 })
    expect(db.prepare("SELECT status FROM dose_expectation_outcomes").get()).toEqual({ status: "confirmed_missed" })
  })

  it("remembers the dose time on every answer so History can place a miss", () => {
    expect(resolve("missed").ok).toBe(true)
    const row = db.prepare("SELECT slot_at FROM dose_expectation_outcomes").get() as { slot_at: string | null }
    expect(row.slot_at).not.toBeNull()
    expect(Number.isFinite(Date.parse(row.slot_at!))).toBe(true)
  })

  it("'not yet' snoozes for an hour from now", () => {
    expect(resolve("not_yet").ok).toBe(true)
    const row = db.prepare("SELECT status, snoozed_until FROM dose_expectation_outcomes").get() as {
      status: string
      snoozed_until: string
    }
    expect(row.status).toBe("snoozed")
    expect(Date.parse(row.snoozed_until)).toBe(NOW + SNOOZE_MS)
    expect(SNOOZE_MS).toBe(60 * 60_000)
  })

  it("lets a snoozed or missed answer be replaced by a later one", () => {
    resolve("not_yet")
    expect(resolve("given").ok).toBe(true)
    expect(db.prepare("SELECT status FROM dose_expectation_outcomes").get()).toEqual({ status: "confirmed_given" })

    // A fresh expectation-day: missed, then corrected to given.
    resolve("missed", { ymd: "2025-01-14", nowMs: Date.parse("2025-01-14T13:00:00.000Z") })
    expect(resolve("given", { ymd: "2025-01-14", nowMs: Date.parse("2025-01-14T13:30:00.000Z") }).ok).toBe(true)
  })

  it("refuses to re-resolve a confirmed-given day, so no duplicate dose is created", () => {
    resolve("given")
    const again = resolve("given")
    expect(again).toEqual({ ok: false, status: 409, error: "This dose has already been confirmed as given" })
    expect(resolve("missed")).toEqual(expect.objectContaining({ ok: false, status: 409 }))
    expect(db.prepare("SELECT COUNT(*) AS n FROM medication_records").get()).toEqual({ n: 1 })
  })

  it("404s an unknown expectation", () => {
    expect(resolve("given", { expectationId: 99 })).toEqual({ ok: false, status: 404, error: "Not found" })
  })

  it("rejects a day the expectation doesn't cover", () => {
    expect(resolve("given", { ymd: "2025-04-01" })).toEqual({
      ok: false,
      status: 400,
      error: "This expectation does not apply on that day",
    })
  })

  it("won't record a 'given' dose for a slot that hasn't happened yet", () => {
    const result = resolve("given", { nowMs: Date.parse("2025-01-15T09:00:00.000Z") })
    expect(result).toEqual({ ok: false, status: 400, error: "That dose time has not happened yet" })
    expect(db.prepare("SELECT COUNT(*) AS n FROM medication_records").get()).toEqual({ n: 0 })
  })

  it("won't pre-answer or snooze a day whose dose time hasn't come", () => {
    const early = Date.parse("2025-01-15T09:00:00.000Z")
    for (const outcome of ["missed", "not_yet"] as const) {
      expect(resolve(outcome, { nowMs: early })).toEqual({ ok: false, status: 400, error: "That dose time has not happened yet" })
    }
    expect(db.prepare("SELECT COUNT(*) AS n FROM dose_expectation_outcomes").get()).toEqual({ n: 0 })
  })

  it("only answers for today in the schedule's timezone", () => {
    expect(resolve("given", { ymd: "2025-01-14" })).toEqual({
      ok: false,
      status: 400,
      error: "Only today's dose can be answered",
    })
    expect(resolve("missed", { ymd: "2025-01-14" })).toEqual(expect.objectContaining({ ok: false, status: 400 }))
    expect(db.prepare("SELECT COUNT(*) AS n FROM medication_records").get()).toEqual({ n: 0 })
  })

  it("404s an expectation on a deactivated person-medication, so a stray answer can't reactivate it", () => {
    db.prepare("UPDATE person_medications SET is_active = 0").run()
    expect(resolve("given")).toEqual({ ok: false, status: 404, error: "Not found" })
    expect(db.prepare("SELECT is_active FROM person_medications").get()).toEqual({ is_active: 0 })
  })

  it("keeps a confirmed miss: a later 'not yet' doesn't reopen the prompt", () => {
    resolve("missed")
    expect(resolve("not_yet")).toEqual(expect.objectContaining({ ok: true, outcome: "confirmed_missed" }))
    expect(db.prepare("SELECT status FROM dose_expectation_outcomes").get()).toEqual({ status: "confirmed_missed" })
  })

  it("a confirmed outcome stops the dashboard asking (round trip through the pending query)", async () => {
    resolve("missed")
    const { evaluateAlertReadiness } = await import("@/lib/alert-readiness")
    const facts = evaluateAlertReadiness(db, [{ id: 1, name: "Alice" } as never], NOW, UTC)
    expect(facts.pendingDoseExpectations).toEqual([])
  })
})
