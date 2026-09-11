// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { NextRequest, NextResponse } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let testDb: Database.Database

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      account_uid TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE medications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      default_dosage REAL,
      dosage_unit TEXT NOT NULL DEFAULT 'Tabs',
      notes TEXT,
      min_age_years INTEGER,
      max_age_years INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE medication_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE medication_group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medication_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      UNIQUE(medication_id, group_id)
    );
    CREATE TABLE person_medications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      medication_id INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      schedule_times TEXT,
      schedule_frequency TEXT,
      UNIQUE(person_id, medication_id)
    );
    CREATE TABLE medication_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      medication_id INTEGER NOT NULL,
      recorded_at DATETIME NOT NULL,
      dosage REAL,
      dosage_unit TEXT,
      comments TEXT,
      created_by TEXT
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

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
}))

vi.mock("@/lib/auth/auth-helpers", () => ({
  requireManage: vi.fn(async () => ({
    session: { user: { email: "manager@test", id: "local:1", groups: ["local:manager"] } },
    groups: ["local:manager"],
  })),
  // Manager role always has write access; this mirrors that without pulling in next-auth.
  authorisePersonAccess: (db: Database.Database, _ctx: unknown, personId: number) => {
    const person = db.prepare("SELECT * FROM people WHERE id = ? AND is_active = 1").get(personId)
    return person ?? NextResponse.json({ error: "Not found" }, { status: 404 })
  },
}))

describe("POST /api/records/[id]/create-variant", () => {
  let personId: number
  let originalMedId: number
  let recordId: number

  beforeEach(() => {
    testDb = createTestDb()
    personId = Number(
      testDb.prepare("INSERT INTO people (name, is_active) VALUES ('Pat', 1)").run().lastInsertRowid,
    )
    originalMedId = Number(
      testDb
        .prepare(
          "INSERT INTO medications (name, default_dosage, dosage_unit, notes, min_age_years, max_age_years) VALUES ('Paracetamol', 500, 'Tabs', 'some notes', 2, 18)",
        )
        .run().lastInsertRowid,
    )
    const groupId = Number(
      testDb.prepare("INSERT INTO medication_groups (name) VALUES ('Pain relief')").run().lastInsertRowid,
    )
    testDb
      .prepare("INSERT INTO medication_group_members (medication_id, group_id) VALUES (?, ?)")
      .run(originalMedId, groupId)
    recordId = Number(
      testDb
        .prepare(
          "INSERT INTO medication_records (person_id, medication_id, recorded_at, dosage, dosage_unit) VALUES (?, ?, '2026-01-01T08:00:00.000Z', 10, 'applications')",
        )
        .run(personId, originalMedId).lastInsertRowid,
    )
  })

  afterEach(() => {
    vi.clearAllMocks()
    testDb.close()
  })

  function makeRequest(body: Record<string, unknown>) {
    return new NextRequest(`http://localhost/api/records/${recordId}/create-variant`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  }

  it("creates a variant prefilled with the recorded unit and re-homes only this record", async () => {
    const { POST } = await import("@/app/api/records/[id]/create-variant/route")
    const res = await POST(makeRequest({ name: "Paracetamol (applications)" }), {
      params: Promise.resolve({ id: String(recordId) }),
    })
    expect(res.status).toBe(201)
    const created = await res.json()
    expect(created.name).toBe("Paracetamol (applications)")
    expect(created.dosage_unit).toBe("applications")
    expect(created.default_dosage).toBe(10)
    expect(created.notes).toBeNull()
    expect(created.min_age_years).toBe(2)
    expect(created.max_age_years).toBe(18)

    const record = testDb.prepare("SELECT medication_id FROM medication_records WHERE id = ?").get(recordId) as {
      medication_id: number
    }
    expect(record.medication_id).toBe(created.id)

    const link = testDb
      .prepare("SELECT is_active, schedule_times FROM person_medications WHERE person_id = ? AND medication_id = ?")
      .get(personId, created.id) as { is_active: number; schedule_times: string | null }
    expect(link.is_active).toBe(1)
    expect(link.schedule_times).toBeNull()
  })

  it("adds the variant to the original's groups without creating a new group", async () => {
    const { POST } = await import("@/app/api/records/[id]/create-variant/route")
    const res = await POST(makeRequest({ name: "Paracetamol (applications)" }), {
      params: Promise.resolve({ id: String(recordId) }),
    })
    const created = await res.json()

    const groupCountBefore = (
      testDb.prepare("SELECT COUNT(*) as c FROM medication_groups").get() as { c: number }
    ).c
    expect(groupCountBefore).toBe(1)

    const memberships = testDb
      .prepare("SELECT group_id FROM medication_group_members WHERE medication_id = ?")
      .all(created.id) as { group_id: number }[]
    const originalMemberships = testDb
      .prepare("SELECT group_id FROM medication_group_members WHERE medication_id = ?")
      .all(originalMedId) as { group_id: number }[]
    expect(memberships.map(m => m.group_id)).toEqual(originalMemberships.map(m => m.group_id))
  })

  it("leaves an ungrouped original's variant ungrouped", async () => {
    const ungroupedMedId = Number(
      testDb
        .prepare("INSERT INTO medications (name, dosage_unit) VALUES ('Ibuprofen', 'Tabs')")
        .run().lastInsertRowid,
    )
    const ungroupedRecordId = Number(
      testDb
        .prepare(
          "INSERT INTO medication_records (person_id, medication_id, recorded_at, dosage, dosage_unit) VALUES (?, ?, '2026-01-01T08:00:00.000Z', 5, 'mL')",
        )
        .run(personId, ungroupedMedId).lastInsertRowid,
    )

    const { POST } = await import("@/app/api/records/[id]/create-variant/route")
    const res = await POST(makeRequest({ name: "Ibuprofen (mL)" }), {
      params: Promise.resolve({ id: String(ungroupedRecordId) }),
    })
    const created = await res.json()
    const memberships = testDb
      .prepare("SELECT group_id FROM medication_group_members WHERE medication_id = ?")
      .all(created.id) as { group_id: number }[]
    expect(memberships).toHaveLength(0)
  })

  it("does not touch other records on the original medication", async () => {
    const otherRecordId = Number(
      testDb
        .prepare(
          "INSERT INTO medication_records (person_id, medication_id, recorded_at, dosage, dosage_unit) VALUES (?, ?, '2026-01-02T08:00:00.000Z', 500, 'Tabs')",
        )
        .run(personId, originalMedId).lastInsertRowid,
    )

    const { POST } = await import("@/app/api/records/[id]/create-variant/route")
    await POST(makeRequest({ name: "Paracetamol (applications)" }), {
      params: Promise.resolve({ id: String(recordId) }),
    })

    const other = testDb.prepare("SELECT medication_id FROM medication_records WHERE id = ?").get(otherRecordId) as {
      medication_id: number
    }
    expect(other.medication_id).toBe(originalMedId)
  })

  it("rejects a duplicate name without creating anything", async () => {
    const { POST } = await import("@/app/api/records/[id]/create-variant/route")
    const res = await POST(makeRequest({ name: "Paracetamol" }), {
      params: Promise.resolve({ id: String(recordId) }),
    })
    expect(res.status).toBe(409)

    const record = testDb.prepare("SELECT medication_id FROM medication_records WHERE id = ?").get(recordId) as {
      medication_id: number
    }
    expect(record.medication_id).toBe(originalMedId)
  })

  it("404s for an unknown record id", async () => {
    const { POST } = await import("@/app/api/records/[id]/create-variant/route")
    const res = await POST(makeRequest({ name: "Anything" }), { params: Promise.resolve({ id: "999999" }) })
    expect(res.status).toBe(404)
  })

  it("400s when name is missing", async () => {
    const { POST } = await import("@/app/api/records/[id]/create-variant/route")
    const res = await POST(makeRequest({}), { params: Promise.resolve({ id: String(recordId) }) })
    expect(res.status).toBe(400)
  })
})
