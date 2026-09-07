import Database from "better-sqlite3-multiple-ciphers"
import { describe, expect, it } from "vitest"

function createRecordsDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE medications (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE medication_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      medication_id INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      dosage REAL,
      dosage_unit TEXT,
      comments TEXT
    );
    INSERT INTO people (id, name) VALUES (1, 'Test');
    INSERT INTO medications (id, name) VALUES (1, 'Med A');
    INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES
      (1, 1, '2025-06-01T10:00:00.000Z'),
      (1, 1, '2025-06-01T09:00:00.000Z'),
      (1, 1, '2025-06-01T08:00:00.000Z');
  `)
  return db
}

function paginateRecords(
  db: Database.Database,
  personId: number,
  limit: number,
  cursor?: { ts: string; id: number },
) {
  const conditions = ["r.person_id = ?"]
  const values: (string | number)[] = [personId]
  if (cursor) {
    conditions.push("(r.recorded_at < ? OR (r.recorded_at = ? AND r.id < ?))")
    values.push(cursor.ts, cursor.ts, cursor.id)
  }
  values.push(limit + 1)
  const sql = `SELECT r.id, r.recorded_at FROM medication_records r
    WHERE ${conditions.join(" AND ")}
    ORDER BY r.recorded_at DESC, r.id DESC LIMIT ?`
  const all = db.prepare(sql).all(...values) as { id: number; recorded_at: string }[]
  const hasMore = all.length > limit
  const rows = hasMore ? all.slice(0, limit) : all
  const nextCursor = hasMore ? { ts: rows[limit - 1]!.recorded_at, id: rows[limit - 1]!.id } : null
  return { rows, nextCursor }
}

describe("medication records cursor pagination", () => {
  it("returns nextCursor when more rows exist", () => {
    const db = createRecordsDb()
    const page1 = paginateRecords(db, 1, 2)
    expect(page1.rows).toHaveLength(2)
    expect(page1.nextCursor).toEqual({ ts: "2025-06-01T09:00:00.000Z", id: 2 })

    const page2 = paginateRecords(db, 1, 2, page1.nextCursor!)
    expect(page2.rows).toHaveLength(1)
    expect(page2.nextCursor).toBeNull()
    db.close()
  })

  it("tie-breaks equal recorded_at on id", () => {
    const db = createRecordsDb()
    db.prepare(
      "INSERT INTO medication_records (person_id, medication_id, recorded_at) VALUES (1, 1, '2025-06-01T10:00:00.000Z')",
    ).run()
    const page1 = paginateRecords(db, 1, 2)
    expect(page1.rows).toHaveLength(2)
    expect(page1.nextCursor).not.toBeNull()
    const page2 = paginateRecords(db, 1, 10, page1.nextCursor!)
    expect(page2.rows.length).toBeGreaterThan(0)
    db.close()
  })
})
