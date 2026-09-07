import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#2B7DC2',
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE medications (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE favourites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_uid TEXT NOT NULL,
      person_id INTEGER NOT NULL,
      action_kind TEXT NOT NULL,
      medication_id INTEGER,
      observation_type TEXT,
      default_value TEXT,
      label TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  return db
}

function isFavouriteResolved(
  db: Database.Database,
  favouriteId: number
): boolean {
  const row = db
    .prepare(
      `SELECT f.action_kind,
              p.name AS person_name,
              m.name AS medication_name
       FROM favourites f
       LEFT JOIN people p ON p.id = f.person_id AND p.is_active = 1
       LEFT JOIN medications m ON m.id = f.medication_id AND m.is_active = 1
       WHERE f.id = ?`
    )
    .get(favouriteId) as {
    action_kind: string
    person_name: string | null
    medication_name: string | null
  }

  return (
    row.person_name !== null &&
    (row.action_kind === "observation" || row.medication_name !== null)
  )
}

describe("favourites resolved state", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alex')").run()
    db.prepare("INSERT INTO medications (id, name) VALUES (10, 'Paracetamol')").run()
  })

  afterEach(() => {
    db.close()
  })

  it("marks a medication favourite resolved when person and medication are active", () => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO favourites (user_uid, person_id, action_kind, medication_id, sort_order)
         VALUES ('uid-1', 1, 'medication', 10, 0)`
      )
      .run()
    expect(isFavouriteResolved(db, Number(lastInsertRowid))).toBe(true)
  })

  it("marks a medication favourite unresolved when the medication is inactive", () => {
    db.prepare("UPDATE medications SET is_active = 0 WHERE id = 10").run()
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO favourites (user_uid, person_id, action_kind, medication_id, sort_order)
         VALUES ('uid-1', 1, 'medication', 10, 0)`
      )
      .run()
    expect(isFavouriteResolved(db, Number(lastInsertRowid))).toBe(false)
  })

  it("marks an observation favourite resolved without a medication join", () => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO favourites (user_uid, person_id, action_kind, observation_type, sort_order)
         VALUES ('uid-1', 1, 'observation', 'Hydration', 0)`
      )
      .run()
    expect(isFavouriteResolved(db, Number(lastInsertRowid))).toBe(true)
  })

  it("assigns monotonic sort_order per user", () => {
    const nextSort = (userUid: string) =>
      (
        db
          .prepare(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextSort FROM favourites WHERE user_uid = ?"
          )
          .get(userUid) as { nextSort: number }
      ).nextSort

    expect(nextSort("uid-1")).toBe(0)
    db.prepare(
      `INSERT INTO favourites (user_uid, person_id, action_kind, observation_type, sort_order)
       VALUES ('uid-1', 1, 'observation', 'Hydration', 0)`
    ).run()
    expect(nextSort("uid-1")).toBe(1)
  })
})
