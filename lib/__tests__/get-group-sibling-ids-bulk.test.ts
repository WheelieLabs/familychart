import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getGroupSiblingIds, getGroupSiblingIdsBulk } from "@/lib/frequency-rule"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE medication_group_members (group_id INTEGER NOT NULL, medication_id INTEGER NOT NULL);
  `)
  return db
}

describe("getGroupSiblingIdsBulk", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => db.close())

  it("returns just itself for a medication with no groups", () => {
    const result = getGroupSiblingIdsBulk(db, [1])
    expect(result.get(1)?.sort()).toEqual([1])
  })

  it("returns empty map for an empty id list", () => {
    const result = getGroupSiblingIdsBulk(db, [])
    expect(result.size).toBe(0)
  })

  it("resolves siblings within a single group", () => {
    db.prepare("INSERT INTO medication_group_members (group_id, medication_id) VALUES (1, 1), (1, 2), (1, 3)").run()
    const result = getGroupSiblingIdsBulk(db, [1, 2, 3])
    expect(result.get(1)?.sort()).toEqual([1, 2, 3])
    expect(result.get(2)?.sort()).toEqual([1, 2, 3])
    expect(result.get(3)?.sort()).toEqual([1, 2, 3])
  })

  it("unions siblings across multiple groups a medication belongs to", () => {
    db.prepare(
      "INSERT INTO medication_group_members (group_id, medication_id) VALUES (1, 1), (1, 2), (2, 1), (2, 4)",
    ).run()
    const result = getGroupSiblingIdsBulk(db, [1])
    expect(result.get(1)?.sort()).toEqual([1, 2, 4])
  })

  it("matches the per-medication getGroupSiblingIds for the same inputs", () => {
    db.prepare(
      "INSERT INTO medication_group_members (group_id, medication_id) VALUES (1, 10), (1, 11), (2, 12), (2, 13)",
    ).run()
    const ids = [10, 11, 12, 13, 14]
    const bulk = getGroupSiblingIdsBulk(db, ids)
    for (const id of ids) {
      expect(bulk.get(id)?.slice().sort((a, b) => a - b)).toEqual(
        getGroupSiblingIds(db, id).slice().sort((a, b) => a - b),
      )
    }
  })
})
