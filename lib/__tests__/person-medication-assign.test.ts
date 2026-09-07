import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ensureActivePersonMedicationLink } from "@/lib/person/person-medication-assign"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE person_medications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      medication_id INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(person_id, medication_id)
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
  return db
}

function activeLinks(db: Database.Database, personId: number, medId: number): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM person_medications WHERE person_id = ? AND medication_id = ? AND is_active = 1",
      )
      .get(personId, medId) as { n: number }
  ).n
}

describe("ensureActivePersonMedicationLink", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })
  afterEach(() => {
    db.close()
  })

  it("creates an active link when none exists (restores ad-hoc recording)", () => {
    const result = ensureActivePersonMedicationLink(db, 1, 10, "carer@example.com")
    expect(result).toBe("created")
    expect(activeLinks(db, 1, 10)).toBe(1)
    const audit = db.prepare("SELECT action, entity_type FROM audit_log").get() as {
      action: string
      entity_type: string
    }
    expect(audit).toMatchObject({ action: "CREATE", entity_type: "person_medications" })
  })

  it("reactivates a soft-deleted link", () => {
    db.prepare(
      "INSERT INTO person_medications (person_id, medication_id, is_active) VALUES (1, 10, 0)",
    ).run()
    const result = ensureActivePersonMedicationLink(db, 1, 10, "carer@example.com")
    expect(result).toBe("reactivated")
    expect(activeLinks(db, 1, 10)).toBe(1)
  })

  it("leaves an already-active link untouched and writes no audit row", () => {
    db.prepare(
      "INSERT INTO person_medications (person_id, medication_id, is_active) VALUES (1, 10, 1)",
    ).run()
    const result = ensureActivePersonMedicationLink(db, 1, 10, "carer@example.com")
    expect(result).toBe("unchanged")
    expect(activeLinks(db, 1, 10)).toBe(1)
    const auditCount = (
      db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }
    ).n
    expect(auditCount).toBe(0)
  })

  it("does not create a duplicate row for a second dose of the same medication", () => {
    ensureActivePersonMedicationLink(db, 1, 10, "carer@example.com")
    ensureActivePersonMedicationLink(db, 1, 10, "carer@example.com")
    const rows = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM person_medications WHERE person_id = 1 AND medication_id = 10",
        )
        .get() as { n: number }
    ).n
    expect(rows).toBe(1)
  })

  it("defaults audit via to record_dose", () => {
    ensureActivePersonMedicationLink(db, 1, 10, "carer@example.com")
    const details = JSON.parse(
      (db.prepare("SELECT details FROM audit_log").get() as { details: string }).details,
    )
    expect(details.via).toBe("record_dose")
  })

  it("records the supplied via on create and reactivate", () => {
    ensureActivePersonMedicationLink(db, 1, 10, "mgr@example.com", "import")
    let details = JSON.parse(
      (db.prepare("SELECT details FROM audit_log ORDER BY id DESC LIMIT 1").get() as {
        details: string
      }).details,
    )
    expect(details.via).toBe("import")

    db.prepare("UPDATE person_medications SET is_active = 0 WHERE person_id = 1 AND medication_id = 10").run()
    ensureActivePersonMedicationLink(db, 1, 10, "mgr@example.com", "import")
    details = JSON.parse(
      (db.prepare("SELECT details FROM audit_log ORDER BY id DESC LIMIT 1").get() as {
        details: string
      }).details,
    )
    expect(details.via).toBe("import")
  })
})
