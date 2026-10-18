import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { appendSymptomOverlapFilters } from "@/lib/symptoms/symptom-overlap"

describe("appendSymptomOverlapFilters", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
    db.exec(`CREATE TABLE symptom_events (
      id INTEGER PRIMARY KEY, label TEXT, start_date TEXT NOT NULL, end_date TEXT,
      is_resolved INTEGER NOT NULL DEFAULT 0, resolved_at TEXT
    )`)
    const add = db.prepare("INSERT INTO symptom_events (label, start_date, end_date, is_resolved, resolved_at) VALUES (?, ?, ?, ?, ?)")
    add.run("before-ended", "2026-07-01T00:00:00.000Z", "2026-07-10T00:00:00.000Z", 1, null)
    add.run("spans-in-from-earlier", "2026-08-25T00:00:00.000Z", "2026-09-02T00:00:00.000Z", 0, null)
    add.run("inside", "2026-09-10T00:00:00.000Z", "2026-09-12T00:00:00.000Z", 0, null)
    add.run("ongoing-from-earlier", "2026-06-01T00:00:00.000Z", null, 0, null)
    add.run("resolved-before", "2026-06-01T00:00:00.000Z", null, 1, "2026-06-05T00:00:00.000Z")
    add.run("resolved-inside", "2026-08-20T00:00:00.000Z", null, 1, "2026-09-04T00:00:00.000Z")
    add.run("starts-after", "2026-10-02T00:00:00.000Z", null, 0, null)
  })

  afterEach(() => db.close())

  it("returns symptoms whose span touches the window, including ones that began earlier", () => {
    const conditions: string[] = []
    const values: (string | number)[] = []
    appendSymptomOverlapFilters(conditions, values, "2026-09-01T00:00:00.000Z", "2026-09-30T23:59:59.999Z")
    const rows = db.prepare(`SELECT label FROM symptom_events WHERE ${conditions.join(" AND ")} ORDER BY id`).all(...values) as { label: string }[]
    expect(rows.map(r => r.label)).toEqual(["spans-in-from-earlier", "inside", "ongoing-from-earlier", "resolved-inside"])
  })
})
