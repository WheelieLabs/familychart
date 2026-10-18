import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { answerOpenSymptom, listOpenSymptomPrompts, type LocalDay } from "@/lib/symptoms/open-symptom-prompts"

// Adelaide in winter: UTC+9:30, so getTimezoneOffset() is -570.
const OFFSET = -570
const today = (ymd: string): LocalDay => ({ ymd, offsetMinutes: OFFSET })
// Local midnight of a day in that zone, as the symptom form stores it.
const localMidnight = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!, 0, 0, 0) + OFFSET * 60_000).toISOString()
}

describe("open symptom prompts", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
    db.exec(`CREATE TABLE symptom_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, person_id INTEGER NOT NULL, label TEXT NOT NULL,
      start_date TEXT NOT NULL, end_date TEXT, severity INTEGER NOT NULL DEFAULT 2,
      is_resolved INTEGER NOT NULL DEFAULT 0, resolved_at TEXT, notes TEXT, ongoing_confirmed_on TEXT
    )`)
  })

  afterEach(() => db.close())

  function add(label: string, start: string, o: { person?: number; end?: string | null; resolved?: number; confirmed?: string | null } = {}): number {
    return Number(db.prepare(
      "INSERT INTO symptom_events (person_id, label, start_date, end_date, is_resolved, ongoing_confirmed_on) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(o.person ?? 1, label, localMidnight(start), o.end ? localMidnight(o.end) : null, o.resolved ?? 0, o.confirmed ?? null).lastInsertRowid)
  }

  const read = (id: number) => db.prepare("SELECT * FROM symptom_events WHERE id = ?").get(id) as Record<string, unknown>

  describe("listOpenSymptomPrompts", () => {
    it("prompts for an open symptom from the day after it started", () => {
      add("Headache", "2026-10-02")
      const prompts = listOpenSymptomPrompts(db, [1], today("2026-10-03"))
      expect(prompts).toEqual([{ symptomId: 1, personId: 1, label: "Headache", startYmd: "2026-10-02" }])
    })

    it("does not prompt on the day it started", () => {
      add("Headache", "2026-10-03")
      expect(listOpenSymptomPrompts(db, [1], today("2026-10-03"))).toEqual([])
    })

    it("never prompts for a symptom with an end date or one already resolved", () => {
      add("Ended", "2026-09-20", { end: "2026-09-25" })
      add("Resolved", "2026-09-20", { resolved: 1 })
      expect(listOpenSymptomPrompts(db, [1], today("2026-10-03"))).toEqual([])
    })

    it("hides a confirmed symptom for the rest of that local day and brings it back the next day", () => {
      add("Headache", "2026-10-01", { confirmed: "2026-10-03" })
      expect(listOpenSymptomPrompts(db, [1], today("2026-10-03"))).toEqual([])
      expect(listOpenSymptomPrompts(db, [1], today("2026-10-04"))).toHaveLength(1)
    })

    it("uses the local day, not UTC, for the start day", () => {
      // 00:00 local on 2026-10-03 is 14:30 UTC on 2026-10-02: still the 3rd locally.
      add("Late", "2026-10-03")
      expect(listOpenSymptomPrompts(db, [1], today("2026-10-03"))).toEqual([])
      expect(listOpenSymptomPrompts(db, [1], today("2026-10-04"))).toHaveLength(1)
    })

    it("gives each open symptom and each person their own prompt, and ignores people not asked about", () => {
      add("Headache", "2026-10-01")
      add("Cough", "2026-10-01")
      add("Rash", "2026-10-01", { person: 2 })
      add("Other", "2026-10-01", { person: 3 })
      const prompts = listOpenSymptomPrompts(db, [1, 2], today("2026-10-03"))
      expect(prompts.map(p => `${p.personId}:${p.label}`)).toEqual(["1:Headache", "1:Cough", "2:Rash"])
    })

    it("returns nothing when no people are asked about", () => {
      expect(listOpenSymptomPrompts(db, [], today("2026-10-03"))).toEqual([])
    })
  })

  describe("answerOpenSymptom", () => {
    it("Still ongoing records today's confirmation and leaves the symptom open", () => {
      const id = add("Headache", "2026-10-01")
      expect(answerOpenSymptom(db, { symptomId: id, answer: { outcome: "ongoing" }, today: today("2026-10-03") }))
        .toEqual({ ok: true, outcome: "ongoing", personId: 1 })
      const row = read(id)
      expect(row.ongoing_confirmed_on).toBe("2026-10-03")
      expect(row.is_resolved).toBe(0)
      expect(row.end_date).toBeNull()
    })

    it("Resolved resolves it with end_date at the start of today and a server-derived resolved_at", () => {
      const id = add("Headache", "2026-10-01")
      const result = answerOpenSymptom(db, { symptomId: id, answer: { outcome: "resolved" }, today: today("2026-10-03") })
      expect(result).toMatchObject({ ok: true, outcome: "resolved" })
      const row = read(id)
      expect(row.is_resolved).toBe(1)
      expect(row.end_date).toBe(localMidnight("2026-10-03"))
      expect(typeof row.resolved_at).toBe("string")
      expect(listOpenSymptomPrompts(db, [1], today("2026-10-03"))).toEqual([])
    })

    it("Resolved earlier writes the chosen day to end_date", () => {
      const id = add("Headache", "2026-10-01")
      const result = answerOpenSymptom(db, { symptomId: id, answer: { outcome: "resolved", resolvedYmd: "2026-10-02" }, today: today("2026-10-03") })
      expect(result.ok).toBe(true)
      expect(read(id).end_date).toBe(localMidnight("2026-10-02"))
    })

    it("accepts the start day itself as the earliest resolved day", () => {
      const id = add("Headache", "2026-10-01")
      expect(answerOpenSymptom(db, { symptomId: id, answer: { outcome: "resolved", resolvedYmd: "2026-10-01" }, today: today("2026-10-03") }).ok).toBe(true)
    })

    it("rejects a resolved day before the start, in the future, or malformed", () => {
      const id = add("Headache", "2026-10-01")
      const t = today("2026-10-03")
      expect(answerOpenSymptom(db, { symptomId: id, answer: { outcome: "resolved", resolvedYmd: "2026-09-30" }, today: t })).toMatchObject({ ok: false, status: 400 })
      expect(answerOpenSymptom(db, { symptomId: id, answer: { outcome: "resolved", resolvedYmd: "2026-10-04" }, today: t })).toMatchObject({ ok: false, status: 400 })
      expect(answerOpenSymptom(db, { symptomId: id, answer: { outcome: "resolved", resolvedYmd: "nope" }, today: t })).toMatchObject({ ok: false, status: 400 })
      expect(read(id).is_resolved).toBe(0)
    })

    it("refuses a symptom that is not open, and one that does not exist", () => {
      const resolved = add("Done", "2026-10-01", { resolved: 1 })
      const ended = add("Ended", "2026-10-01", { end: "2026-10-02" })
      const t = today("2026-10-03")
      expect(answerOpenSymptom(db, { symptomId: resolved, answer: { outcome: "ongoing" }, today: t })).toMatchObject({ ok: false, status: 409 })
      expect(answerOpenSymptom(db, { symptomId: ended, answer: { outcome: "resolved" }, today: t })).toMatchObject({ ok: false, status: 409 })
      expect(answerOpenSymptom(db, { symptomId: 999, answer: { outcome: "ongoing" }, today: t })).toMatchObject({ ok: false, status: 404 })
    })
  })
})
