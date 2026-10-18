import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import {
  addLinks,
  candidateDosesForSpan,
  candidateSymptomsForDose,
  changeLinks,
  linkedDosesForSymptom,
  linkedSymptomsForDose,
  listPersonLinks,
  parseIdList,
  symptomSpanYmd,
  validateLinkTargets,
} from "@/lib/symptoms/symptom-dose-links"

const authorisePersonAccess = vi.fn()
vi.mock("@/lib/auth/auth-helpers", () => ({
  requireAuth: vi.fn(async () => ({ session: { user: { email: "me@test" } }, groups: [] })),
  authorisePersonAccess: (...args: unknown[]) => authorisePersonAccess(...args),
}))
let testDb: Database.Database
vi.mock("@/lib/db", () => ({ getDb: () => testDb }))

function createDb() {
  const db = new Database(":memory:")
  db.pragma("foreign_keys = ON")
  db.exec(`
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE medications (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE medication_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, person_id INTEGER NOT NULL REFERENCES people(id),
      medication_id INTEGER NOT NULL REFERENCES medications(id), recorded_at TEXT NOT NULL, dosage REAL, dosage_unit TEXT
    );
    CREATE TABLE symptom_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, person_id INTEGER NOT NULL REFERENCES people(id), label TEXT NOT NULL,
      start_date TEXT NOT NULL, end_date TEXT, severity INTEGER NOT NULL DEFAULT 1, is_resolved INTEGER NOT NULL DEFAULT 0, resolved_at TEXT
    );
    CREATE TABLE symptom_dose_links (
      symptom_event_id INTEGER NOT NULL REFERENCES symptom_events(id) ON DELETE CASCADE,
      medication_record_id INTEGER NOT NULL REFERENCES medication_records(id) ON DELETE CASCADE,
      person_id INTEGER NOT NULL REFERENCES people(id), created_by TEXT, created_at TEXT,
      PRIMARY KEY (symptom_event_id, medication_record_id)
    );
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, action TEXT, entity_type TEXT, entity_id INTEGER, details TEXT);
    INSERT INTO people VALUES (1, 'Pat'), (2, 'Sam');
    INSERT INTO medications VALUES (1, 'Paracetamol');
  `)
  return db
}

// Offset 0 (UTC) keeps local days equal to UTC days in the fixtures.
const TODAY = "2026-02-10"
const dose = (db: Database.Database, person: number, at: string) =>
  Number(db.prepare("INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (?, 1, ?)").run(person, at).lastInsertRowid)
const symptom = (db: Database.Database, person: number, start: string, end: string | null = null, resolved = 0, resolvedAt: string | null = null) =>
  Number(db.prepare("INSERT INTO symptom_events (person_id, label, start_date, end_date, is_resolved, resolved_at) VALUES (?, 'Headache', ?, ?, ?, ?)").run(person, start, end, resolved, resolvedAt).lastInsertRowid)

describe("symptom/dose links", () => {
  let db: Database.Database
  beforeEach(() => { db = createDb() })
  afterEach(() => db.close())

  it("computes spans like the Calendar: end date, else resolved day, else through today", () => {
    const base = { start_date: "2026-02-01T00:00:00Z", end_date: null, is_resolved: false, resolved_at: null }
    expect(symptomSpanYmd({ ...base, end_date: "2026-02-03T00:00:00Z" }, TODAY, 0)).toEqual({ start: "2026-02-01", end: "2026-02-03" })
    expect(symptomSpanYmd({ ...base, is_resolved: true, resolved_at: "2026-02-04T15:00:00Z" }, TODAY, 0).end).toBe("2026-02-04")
    expect(symptomSpanYmd(base, TODAY, 0).end).toBe(TODAY)
  })

  it("offers a dose the symptoms whose span covers its local day, same Person only, backdated doses included", () => {
    const open = symptom(db, 1, "2026-02-01T00:00:00Z")
    symptom(db, 1, "2026-01-01T00:00:00Z", "2026-01-05T00:00:00Z") // ended before
    symptom(db, 1, "2026-02-08T00:00:00Z") // starts after a backdated dose
    symptom(db, 2, "2026-02-01T00:00:00Z") // other person
    expect(candidateSymptomsForDose(db, 1, "2026-02-03T08:00:00Z", TODAY, 0).map(s => s.id)).toEqual([open])
    expect(candidateSymptomsForDose(db, 1, "2026-02-09T08:00:00Z", TODAY, 0)).toHaveLength(2)
  })

  it("uses the local day, not the UTC day, when the device is offset from UTC", () => {
    // Device at UTC+10:30 (getTimezoneOffset = -630): 2026-02-02T20:00Z is already Feb 3 locally.
    symptom(db, 1, "2026-02-03T05:00:00Z", "2026-02-03T05:00:00Z") // Feb 3 in UTC and locally
    expect(candidateSymptomsForDose(db, 1, "2026-02-02T20:00:00Z", "2026-02-10", -630)).toHaveLength(1)
    expect(candidateSymptomsForDose(db, 1, "2026-02-02T20:00:00Z", "2026-02-10", 0)).toHaveLength(0)
  })

  it("offers a symptom its Person's doses across its span, newest first, capped on request", () => {
    const sym = { start_date: "2026-02-01T00:00:00Z", end_date: null, is_resolved: false, resolved_at: null }
    const ids = [1, 2, 3, 4, 5, 6, 7].map(d => dose(db, 1, `2026-02-0${d}T09:00:00Z`))
    dose(db, 1, "2026-01-31T09:00:00Z") // before the span
    dose(db, 2, "2026-02-03T09:00:00Z") // other person
    const all = candidateDosesForSpan(db, 1, sym, TODAY, 0)
    expect(all.map(d => d.id)).toEqual([...ids].reverse())
    expect(candidateDosesForSpan(db, 1, sym, TODAY, 0, 5).map(d => d.id)).toEqual([...ids].reverse().slice(0, 5))
  })

  it("rejects ids from another Person", () => {
    const s1 = symptom(db, 1, "2026-02-01T00:00:00Z")
    const d2 = dose(db, 2, "2026-02-02T09:00:00Z")
    expect(validateLinkTargets(db, 1, [s1], [d2])).toMatch(/Dose not found/)
    expect(validateLinkTargets(db, 2, [s1], [])).toMatch(/Symptom not found/)
    expect(validateLinkTargets(db, 1, [s1], [])).toBeNull()
    expect(validateLinkTargets(db, 1, [999], [])).not.toBeNull()
  })

  it("links many-to-many, ignores duplicates, and describes both sides", () => {
    const s1 = symptom(db, 1, "2026-02-01T00:00:00Z")
    const s2 = symptom(db, 1, "2026-02-02T00:00:00Z")
    const d1 = dose(db, 1, "2026-02-03T09:00:00Z")
    expect(addLinks(db, { personId: 1, symptomIds: [s1, s2], recordIds: [d1], createdBy: "me" })).toHaveLength(2)
    expect(addLinks(db, { personId: 1, symptomIds: [s1], recordIds: [d1], createdBy: "me" })).toHaveLength(0)
    expect(linkedSymptomsForDose(db, d1).map(s => s.id).sort()).toEqual([s1, s2])
    expect(linkedDosesForSymptom(db, s1).map(d => d.id)).toEqual([d1])
    expect(listPersonLinks(db, 1)).toHaveLength(2)
    expect(listPersonLinks(db, 2)).toEqual([])
  })

  it("deleting either side removes its links and leaves the other record", () => {
    const s1 = symptom(db, 1, "2026-02-01T00:00:00Z")
    const d1 = dose(db, 1, "2026-02-03T09:00:00Z")
    const d2 = dose(db, 1, "2026-02-04T09:00:00Z")
    addLinks(db, { personId: 1, symptomIds: [s1], recordIds: [d1, d2], createdBy: null })
    db.prepare("DELETE FROM medication_records WHERE id = ?").run(d1)
    expect(linkedDosesForSymptom(db, s1).map(d => d.id)).toEqual([d2])
    db.prepare("DELETE FROM symptom_events WHERE id = ?").run(s1)
    expect(db.prepare("SELECT COUNT(*) AS n FROM symptom_dose_links").get()).toEqual({ n: 0 })
    expect(db.prepare("SELECT COUNT(*) AS n FROM medication_records").get()).toEqual({ n: 1 })
  })

  it("audit-logs each change on both records", () => {
    const s1 = symptom(db, 1, "2026-02-01T00:00:00Z")
    const d1 = dose(db, 1, "2026-02-03T09:00:00Z")
    changeLinks(db, { personId: 1, actorEmail: "me", add: { symptomIds: [s1], recordIds: [d1] } })
    changeLinks(db, { personId: 1, actorEmail: "me", remove: { symptomIds: [s1], recordIds: [d1] } })
    const rows = db.prepare("SELECT action, entity_type FROM audit_log ORDER BY id").all()
    expect(rows).toEqual([
      { action: "LINK", entity_type: "symptom_events" }, { action: "LINK", entity_type: "medication_records" },
      { action: "UNLINK", entity_type: "symptom_events" }, { action: "UNLINK", entity_type: "medication_records" },
    ])
  })

  it("parses id lists strictly", () => {
    expect(parseIdList(undefined)).toEqual([])
    expect(parseIdList([1, 2])).toEqual([1, 2])
    expect(parseIdList(["1"])).toBeNull()
    expect(parseIdList("1")).toBeNull()
  })

  describe("PUT /api/symptom-dose-links", () => {
    beforeEach(() => {
      testDb = db
      authorisePersonAccess.mockReset()
      authorisePersonAccess.mockReturnValue({ id: 1 })
    })
    const put = async (body: object) => {
      const { PUT } = await import("@/app/api/symptom-dose-links/route")
      return PUT(new NextRequest("http://localhost/api/symptom-dose-links", { method: "PUT", body: JSON.stringify(body) }))
    }

    it("needs write access", async () => {
      authorisePersonAccess.mockReturnValue(NextResponse.json({ error: "Not found" }, { status: 404 }))
      const res = await put({ person_id: 1, symptom_id: 1, add_record_ids: [] })
      expect(res.status).toBe(404)
      expect(authorisePersonAccess).toHaveBeenCalledWith(db, expect.anything(), 1, "write")
    })

    it("adds and removes from the symptom side, and from the dose side", async () => {
      const s1 = symptom(db, 1, "2026-02-01T00:00:00Z")
      const d1 = dose(db, 1, "2026-02-03T09:00:00Z")
      const d2 = dose(db, 1, "2026-02-04T09:00:00Z")
      expect((await put({ person_id: 1, symptom_id: s1, add_record_ids: [d1, d2] })).status).toBe(200)
      expect(linkedDosesForSymptom(db, s1)).toHaveLength(2)
      await put({ person_id: 1, record_id: d1, remove_symptom_ids: [s1] })
      expect(linkedDosesForSymptom(db, s1).map(d => d.id)).toEqual([d2])
    })

    it("refuses a link that would cross Persons and writes nothing", async () => {
      const s1 = symptom(db, 1, "2026-02-01T00:00:00Z")
      const other = dose(db, 2, "2026-02-03T09:00:00Z")
      const res = await put({ person_id: 1, symptom_id: s1, add_record_ids: [other] })
      expect(res.status).toBe(400)
      expect(db.prepare("SELECT COUNT(*) AS n FROM symptom_dose_links").get()).toEqual({ n: 0 })
    })
  })
})
