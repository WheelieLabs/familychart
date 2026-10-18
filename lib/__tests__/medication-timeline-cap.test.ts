// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { CalendarContext } from "@/lib/calendar-context"
import { buildMedicationTimelines } from "@/lib/dashboard/dashboard-medication-timeline"
import { evaluateDashboardPersonStatus } from "@/lib/dashboard/dashboard-person-status"
import { applyBaselineSchema } from "@/lib/db"
import type { Person } from "@/lib/domain-types"
import { evaluateAlertReadiness } from "@/lib/alert-readiness"

// Dose totals are read against the database clock, so these fixtures run on the real clock.
const NOW = new Date()
const calCtx: CalendarContext = { ymd: NOW.toISOString().slice(0, 10), offsetMinutes: 0, ianaTz: "UTC" }
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()
const person: Person = {
  id: 1, name: "Alice", full_name: null, photo_url: null, color: "#256AA5", sort_order: 0, is_active: 1,
  account_uid: null, date_of_birth: null,
}

describe("medication timeline: the 24h cap reads the dashboard's decision", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
    db.pragma("foreign_keys = ON")
    applyBaselineSchema(db)
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
  })
  afterEach(() => db.close())

  function seed(opts: {
    scheduled?: boolean
    endDate?: string | null
    weekly?: boolean
    rule: { maxQty: number; countDoses: 0 | 1; dosage?: number | null; minHours?: number }
    doses: { hoursAgo: number; dosage?: number | null; unit?: string | null }[]
    defaultDosage?: number | null
  }) {
    db.prepare("INSERT INTO medications (id, name, default_dosage, dosage_unit) VALUES (1, 'Paracetamol', ?, 'Tabs')").run(opts.defaultDosage ?? null)
    if (opts.scheduled === false) {
      db.prepare("INSERT INTO person_medications (id, person_id, medication_id) VALUES (1, 1, 1)").run()
    } else {
      db.prepare(
        `INSERT INTO person_medications
           (id, person_id, medication_id, schedule_times, schedule_frequency, schedule_start_date, schedule_end_date, schedule_tz)
         VALUES (1, 1, 1, ?, ?, '2020-01-01', ?, 'UTC')`,
      ).run(
        JSON.stringify(["03:00"]),
        JSON.stringify(opts.weekly ? { kind: "weekly", weekdays: [(NOW.getUTCDay() + 3) % 7] } : { kind: "daily" }),
        opts.endDate ?? null,
      )
    }
    db.prepare(
      `INSERT INTO medication_frequency_rules
         (id, medication_id, min_hours_between, max_quantity_per_24h, max_per_24h_count_doses, dosage)
       VALUES (1, 1, ?, ?, ?, ?)`,
    ).run(opts.rule.minHours ?? 0, opts.rule.maxQty, opts.rule.countDoses, opts.rule.dosage ?? null)
    for (const d of opts.doses) {
      db.prepare("INSERT INTO medication_records (person_id, medication_id, recorded_at, dosage, dosage_unit) VALUES (1, 1, ?, ?, ?)")
        .run(hoursAgo(d.hoursAgo), d.dosage ?? null, d.unit ?? null)
    }
  }

  const status = () => evaluateDashboardPersonStatus(db, [person], { now: NOW, calCtx })[0]
  const lane = () => buildMedicationTimelines(db, [person], NOW, calCtx).get(1)![0]!
  const kinds = () => (status().issues ?? []).map(i => i.kind)

  /** The timeline and the dashboard must tell the same story about this fixture. */
  function expectParity() {
    const l = lane()
    expect(l.atCap).toBe(kinds().includes("prn_at_cap"))
    expect(l.cooldown !== null).toBe(kinds().includes("prn_cooldown"))
    expect(status().medicationTimeline?.[0]).toEqual(l)
    return l
  }

  it("keeps the cap flag and band for a scheduled medication allowing two doses a day", () => {
    seed({ rule: { maxQty: 2, countDoses: 1 }, doses: [{ hoursAgo: 3 }, { hoursAgo: 1 }] })
    const l = expectParity()
    expect(l.kind).toBe("scheduled")
    expect(l.atCap).toBe(true)
    expect(l.capWindow).not.toBeNull()
  })

  it("shows no cap for a scheduled once-a-day medication, only its slots", () => {
    seed({ rule: { maxQty: 1, countDoses: 1 }, doses: [{ hoursAgo: 1 }] })
    const l = expectParity()
    expect(l.atCap).toBe(false)
    expect(l.capWindow).toBeNull()
    expect(l.slotLines.length).toBeGreaterThan(0)
  })

  it("treats a quantity maximum of exactly one dose unit as once a day", () => {
    seed({ rule: { maxQty: 1, countDoses: 0, dosage: 1 }, doses: [{ hoursAgo: 1, dosage: 1, unit: "Tabs" }] })
    expect(expectParity().atCap).toBe(false)
  })

  it("keeps the cap for a quantity maximum of two dose units", () => {
    seed({ rule: { maxQty: 2, countDoses: 0, dosage: 1 }, doses: [{ hoursAgo: 2, dosage: 1, unit: "Tabs" }, { hoursAgo: 1, dosage: 1, unit: "Tabs" }] })
    expect(expectParity().atCap).toBe(true)
  })

  it("keeps the cap when the dose unit cannot be resolved", () => {
    // A recorded dose normally supplies the unit, so an unresolved one only arises with a dose of
    // unknown strength: no unit anywhere, and the quantity already at its maximum.
    seed({ rule: { maxQty: 0, countDoses: 0, dosage: null }, defaultDosage: null, doses: [{ hoursAgo: 1, dosage: null, unit: null }] })
    expect(expectParity().atCap).toBe(true)
  })

  it("treats an ended schedule as unscheduled, so the once-a-day cap shows", () => {
    seed({ endDate: "2024-01-01", rule: { maxQty: 1, countDoses: 1 }, doses: [{ hoursAgo: 1 }] })
    const l = expectParity()
    expect(l.kind).toBe("prn")
    expect(l.atCap).toBe(true)
  })

  it("treats an unscheduled once-a-day medication as PRN with the cap shown", () => {
    seed({ scheduled: false, rule: { maxQty: 1, countDoses: 1 }, doses: [{ hoursAgo: 1 }] })
    const l = expectParity()
    expect(l.kind).toBe("prn")
    expect(l.atCap).toBe(true)
    expect(l.capWindow).not.toBeNull()
  })

  it("still counts a weekly schedule on an off weekday as scheduled", () => {
    seed({ weekly: true, rule: { maxQty: 1, countDoses: 1 }, doses: [{ hoursAgo: 1 }] })
    const l = expectParity()
    expect(l.kind).toBe("scheduled")
    expect(l.atCap).toBe(false)
  })

  it("shows the cooldown band on a scheduled lane while the cooldown blocks, with no next-eligible marker", () => {
    seed({ rule: { maxQty: 4, countDoses: 1, minHours: 6 }, doses: [{ hoursAgo: 1 }] })
    const l = expectParity()
    expect(l.cooldown).not.toBeNull()
    expect(l.markers.some(m => m.kind === "next_eligible")).toBe(false)
  })

  it("keeps the cooldown band and the next-eligible marker on a PRN lane", () => {
    seed({ scheduled: false, rule: { maxQty: 4, countDoses: 1, minHours: 6 }, doses: [{ hoursAgo: 1 }] })
    const l = expectParity()
    expect(l.cooldown).not.toBeNull()
    expect(l.markers.some(m => m.kind === "next_eligible")).toBe(true)
  })

  describe("reminder blocking follows the same decision", () => {
    // A slot due right now, so there is a scheduled reminder to block or release.
    const seedDueSlot = () => {
      const hhmm = new Date(NOW.getTime() - 10 * 60_000).toISOString().slice(11, 16)
      db.prepare("UPDATE person_medications SET schedule_times = ?").run(JSON.stringify([hhmm]))
    }

    it("moves the due slot of a scheduled twice-a-day medication at its cap to the blocked list", () => {
      seed({ rule: { maxQty: 2, countDoses: 1 }, doses: [{ hoursAgo: 8 }, { hoursAgo: 6 }] })
      seedDueSlot()
      const facts = evaluateAlertReadiness(db, [person], NOW.getTime(), calCtx)
      expect(facts.prnBlockedSlots).toHaveLength(1)
      expect(facts.scheduledSlots).toHaveLength(0)
      expect(lane().atCap).toBe(true)
    })

    it("leaves the due slot of a scheduled once-a-day medication as a normal reminder", () => {
      seed({ rule: { maxQty: 1, countDoses: 1 }, doses: [{ hoursAgo: 20 }] })
      seedDueSlot()
      const facts = evaluateAlertReadiness(db, [person], NOW.getTime(), calCtx)
      expect(facts.prnBlockedSlots).toHaveLength(0)
      expect(facts.scheduledSlots).toHaveLength(1)
      expect(lane().atCap).toBe(false)
    })

    it("blocks the due slot while a cooldown applies, even for a once-a-day medication", () => {
      seed({ rule: { maxQty: 1, countDoses: 1, minHours: 30 }, doses: [{ hoursAgo: 20 }] })
      seedDueSlot()
      const facts = evaluateAlertReadiness(db, [person], NOW.getTime(), calCtx)
      expect(facts.prnBlockedSlots).toHaveLength(1)
      expect(lane().cooldown).not.toBeNull()
    })
  })
})
