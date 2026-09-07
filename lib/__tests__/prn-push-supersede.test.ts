import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { clearSupersededPrnPushRequests } from "@/lib/prn/prn-push-supersede"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE medication_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      medication_id INTEGER NOT NULL,
      recorded_at DATETIME NOT NULL
    );
    CREATE TABLE prn_push_requests (
      medication_record_id INTEGER PRIMARY KEY REFERENCES medication_records(id) ON DELETE CASCADE,
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      remind_after_hours REAL
    );
    CREATE TABLE medication_group_members (group_id INTEGER NOT NULL, medication_id INTEGER NOT NULL);
    CREATE TABLE push_log (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      ref_key TEXT NOT NULL UNIQUE,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
  return db
}

function markDelivered(db: Database.Database, recordId: number): void {
  db.prepare("INSERT INTO push_log (ref_key) VALUES (?)").run(`prn:${recordId}`)
}

function insertRecord(db: Database.Database, personId: number, medicationId: number, recordedAt: string): number {
  const result = db
    .prepare("INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (?, ?, ?)")
    .run(personId, medicationId, recordedAt)
  return Number(result.lastInsertRowid)
}

function insertPendingRequest(db: Database.Database, recordId: number, remindAfterHours = 4): void {
  db.prepare(
    "INSERT INTO prn_push_requests (medication_record_id, remind_after_hours) VALUES (?, ?)",
  ).run(recordId, remindAfterHours)
}

function pendingIds(db: Database.Database): number[] {
  return (db.prepare("SELECT medication_record_id FROM prn_push_requests ORDER BY medication_record_id").all() as {
    medication_record_id: number
  }[]).map(r => r.medication_record_id)
}

describe("clearSupersededPrnPushRequests", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => db.close())

  it("clears an older pending request for the same person + medication", () => {
    const a = insertRecord(db, 1, 100, "2026-08-01T10:00:00.000Z")
    insertPendingRequest(db, a)
    const b = insertRecord(db, 1, 100, "2026-08-01T14:00:00.000Z")

    const cleared = clearSupersededPrnPushRequests(db, {
      personId: 1, medicationId: 100, currentRecordId: b, recordedAt: "2026-08-01T14:00:00.000Z",
    })

    expect(cleared).toBe(1)
    expect(pendingIds(db)).toEqual([])
  })

  it("does not clear a backdated dose's request when the new dose is earlier", () => {
    const a = insertRecord(db, 1, 100, "2026-08-01T14:00:00.000Z")
    insertPendingRequest(db, a)
    // A backdated entry recorded after the fact for an earlier time
    const b = insertRecord(db, 1, 100, "2026-08-01T10:00:00.000Z")

    const cleared = clearSupersededPrnPushRequests(db, {
      personId: 1, medicationId: 100, currentRecordId: b, recordedAt: "2026-08-01T10:00:00.000Z",
    })

    expect(cleared).toBe(0)
    expect(pendingIds(db)).toEqual([a])
  })

  it("clears a sibling medication's pending request via group membership", () => {
    db.prepare("INSERT INTO medication_group_members (group_id, medication_id) VALUES (1, 100), (1, 200)").run()
    const a = insertRecord(db, 1, 100, "2026-08-01T10:00:00.000Z")
    insertPendingRequest(db, a)
    const b = insertRecord(db, 1, 200, "2026-08-01T14:00:00.000Z")

    const cleared = clearSupersededPrnPushRequests(db, {
      personId: 1, medicationId: 200, currentRecordId: b, recordedAt: "2026-08-01T14:00:00.000Z",
    })

    expect(cleared).toBe(1)
  })

  it("does not clear a different person's pending request", () => {
    const a = insertRecord(db, 1, 100, "2026-08-01T10:00:00.000Z")
    insertPendingRequest(db, a)
    const b = insertRecord(db, 2, 100, "2026-08-01T14:00:00.000Z")

    const cleared = clearSupersededPrnPushRequests(db, {
      personId: 2, medicationId: 100, currentRecordId: b, recordedAt: "2026-08-01T14:00:00.000Z",
    })

    expect(cleared).toBe(0)
    expect(pendingIds(db)).toEqual([a])
  })

  it("does not clear an unrelated medication's request", () => {
    const a = insertRecord(db, 1, 100, "2026-08-01T10:00:00.000Z")
    insertPendingRequest(db, a)
    const b = insertRecord(db, 1, 999, "2026-08-01T14:00:00.000Z")

    const cleared = clearSupersededPrnPushRequests(db, {
      personId: 1, medicationId: 999, currentRecordId: b, recordedAt: "2026-08-01T14:00:00.000Z",
    })

    expect(cleared).toBe(0)
    expect(pendingIds(db)).toEqual([a])
  })

  it("resolves an equal-recorded_at tie by medication_record_id, never deleting the current record's own request", () => {
    const a = insertRecord(db, 1, 100, "2026-08-01T10:00:00.000Z")
    insertPendingRequest(db, a)
    const b = insertRecord(db, 1, 100, "2026-08-01T10:00:00.000Z") // same instant, higher id
    insertPendingRequest(db, b)

    const cleared = clearSupersededPrnPushRequests(db, {
      personId: 1, medicationId: 100, currentRecordId: b, recordedAt: "2026-08-01T10:00:00.000Z",
    })

    // a has the lower id at an equal timestamp, so it's superseded; b (current record) survives.
    expect(cleared).toBe(1)
    expect(pendingIds(db)).toEqual([b])
  })

  it("clears multiple older pending requests at once", () => {
    const a = insertRecord(db, 1, 100, "2026-08-01T08:00:00.000Z")
    insertPendingRequest(db, a)
    const b = insertRecord(db, 1, 100, "2026-08-01T09:00:00.000Z")
    insertPendingRequest(db, b)
    const c = insertRecord(db, 1, 100, "2026-08-01T14:00:00.000Z")

    const cleared = clearSupersededPrnPushRequests(db, {
      personId: 1, medicationId: 100, currentRecordId: c, recordedAt: "2026-08-01T14:00:00.000Z",
    })

    expect(cleared).toBe(2)
    expect(pendingIds(db)).toEqual([])
  })

  it("is a no-op when there is nothing pending", () => {
    const b = insertRecord(db, 1, 100, "2026-08-01T14:00:00.000Z")
    const cleared = clearSupersededPrnPushRequests(db, {
      personId: 1, medicationId: 100, currentRecordId: b, recordedAt: "2026-08-01T14:00:00.000Z",
    })
    expect(cleared).toBe(0)
  })

  it("deletes an already-delivered stale request but does not count it as cleared", () => {
    const a = insertRecord(db, 1, 100, "2026-08-01T10:00:00.000Z")
    insertPendingRequest(db, a)
    markDelivered(db, a) // the reminder already fired before the next dose was recorded
    const b = insertRecord(db, 1, 100, "2026-08-01T20:00:00.000Z")

    const cleared = clearSupersededPrnPushRequests(db, {
      personId: 1, medicationId: 100, currentRecordId: b, recordedAt: "2026-08-01T20:00:00.000Z",
    })

    // Stale row is still removed (tidy-up)...
    expect(pendingIds(db)).toEqual([])
    // ...but nothing was pre-emptively cancelled, so it shouldn't be reported as such.
    expect(cleared).toBe(0)
  })

  it("counts a mix of delivered and never-delivered stale requests correctly", () => {
    const a = insertRecord(db, 1, 100, "2026-08-01T08:00:00.000Z")
    insertPendingRequest(db, a)
    markDelivered(db, a)
    const b = insertRecord(db, 1, 100, "2026-08-01T09:00:00.000Z")
    insertPendingRequest(db, b) // never delivered
    const c = insertRecord(db, 1, 100, "2026-08-01T14:00:00.000Z")

    const cleared = clearSupersededPrnPushRequests(db, {
      personId: 1, medicationId: 100, currentRecordId: c, recordedAt: "2026-08-01T14:00:00.000Z",
    })

    expect(pendingIds(db)).toEqual([])
    expect(cleared).toBe(1)
  })
})
