import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  ensurePeopleAccountUidUniqueIndex,
  findPersonAccountUidConflict,
  hasPeopleAccountUidUniqueIndex,
  migratePeopleAccountUidUnique,
  normalizePersonAccountUid,
  PEOPLE_ACCOUNT_UID_UNIQUE_INDEX,
  reconcileDuplicatePeopleAccountUids,
} from "@/lib/people-user-uid"

function createPeopleDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE people (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      full_name     TEXT,
      photo_url     TEXT,
      color         TEXT NOT NULL DEFAULT '#2B7DC2',
      sort_order    INTEGER NOT NULL DEFAULT 0,
      is_active     INTEGER NOT NULL DEFAULT 1,
      account_uid   TEXT,
      date_of_birth TEXT
    );
  `)
  return db
}

describe("normalizePersonAccountUid", () => {
  it("trims and preserves non-empty values", () => {
    expect(normalizePersonAccountUid("  entra-oid  ")).toBe("entra-oid")
    expect(normalizePersonAccountUid("local:3")).toBe("local:3")
  })

  it("maps blank values to null", () => {
    expect(normalizePersonAccountUid("")).toBeNull()
    expect(normalizePersonAccountUid("   ")).toBeNull()
    expect(normalizePersonAccountUid(null)).toBeNull()
    expect(normalizePersonAccountUid(undefined)).toBeNull()
  })
})

describe("people account_uid integrity", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createPeopleDb()
  })

  afterEach(() => {
    db.close()
  })

  it("reconciles duplicates by keeping the lowest person id", () => {
    db.prepare(
      "INSERT INTO people (name, account_uid) VALUES (?, ?), (?, ?), (?, ?)",
    ).run("A", "uid-1", "B", "uid-1", "C", "other")

    const { cleared } = reconcileDuplicatePeopleAccountUids(db)
    expect(cleared).toEqual([
      { personId: 2, accountUid: "uid-1", keptPersonId: 1 },
    ])

    const rows = db
      .prepare("SELECT id, account_uid FROM people ORDER BY id")
      .all() as { id: number; account_uid: string | null }[]
    expect(rows).toEqual([
      { id: 1, account_uid: "uid-1" },
      { id: 2, account_uid: null },
      { id: 3, account_uid: "other" },
    ])
  })

  it("creates partial unique index and rejects duplicate inserts", () => {
    migratePeopleAccountUidUnique(db)
    expect(hasPeopleAccountUidUniqueIndex(db)).toBe(true)

    db.prepare("INSERT INTO people (name, account_uid) VALUES (?, ?)").run("A", "uid-1")
    expect(() =>
      db.prepare("INSERT INTO people (name, account_uid) VALUES (?, ?)").run("B", "uid-1"),
    ).toThrow()

    db.prepare("INSERT INTO people (name, account_uid) VALUES (?, ?)").run("C", null)
    db.prepare("INSERT INTO people (name, account_uid) VALUES (?, ?)").run("D", null)
    const nullCount = (
      db.prepare("SELECT COUNT(*) AS n FROM people WHERE account_uid IS NULL").get() as {
        n: number
      }
    ).n
    expect(nullCount).toBe(2)
  })

  it("findPersonAccountUidConflict ignores inactive people and self", () => {
    db.prepare("INSERT INTO people (name, account_uid, is_active) VALUES (?, ?, 0)").run(
      "Inactive",
      "uid-old",
    )
    db.prepare("INSERT INTO people (name, account_uid) VALUES (?, ?)").run("Active", "uid-1")

    expect(findPersonAccountUidConflict(db, "uid-old")).toBeUndefined()
    expect(findPersonAccountUidConflict(db, "uid-1", 2)).toBeUndefined()
    expect(findPersonAccountUidConflict(db, "uid-1")?.id).toBe(2)
    expect(findPersonAccountUidConflict(db, "uid-1", 1)?.id).toBe(2)
  })

  it("migrate is idempotent when index already exists", () => {
    ensurePeopleAccountUidUniqueIndex(db)
    db.prepare("INSERT INTO people (name, account_uid) VALUES (?, ?)").run("Only", "uid-1")

    const second = migratePeopleAccountUidUnique(db)
    expect(second.reconciled.cleared).toEqual([])
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(PEOPLE_ACCOUNT_UID_UNIQUE_INDEX),
    ).toBeTruthy()
  })
})
