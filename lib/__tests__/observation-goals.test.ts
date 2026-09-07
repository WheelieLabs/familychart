import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { deleteObservationGoal, getObservationGoal, setObservationGoal } from "@/lib/observation/observation-goals"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE observation_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      observation_type TEXT NOT NULL,
      goal_type TEXT NOT NULL DEFAULT 'daily_min',
      target_value REAL NOT NULL,
      target_max REAL,
      unit TEXT NOT NULL,
      target_date TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(person_id, observation_type, goal_type)
    );
  `)
  return db
}

describe("observation goals", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it("creates and reads an active goal", () => {
    setObservationGoal(db, 1, "Hydration", "daily_min", 1500, null, "mL", null)
    const goal = getObservationGoal(db, 1, "Hydration")
    expect(goal).toMatchObject({
      person_id: 1,
      observation_type: "Hydration",
      goal_type: "daily_min",
      target_value: 1500,
      unit: "mL",
      is_active: 1,
    })
  })

  it("upserts on conflict for the same person, type, and goal_type", () => {
    setObservationGoal(db, 1, "Hydration", "daily_min", 1200, null, "mL", null)
    setObservationGoal(db, 1, "Hydration", "daily_min", 1800, 2200, "mL", "2026-07-01")

    const goal = getObservationGoal(db, 1, "Hydration")
    expect(goal).toMatchObject({
      target_value: 1800,
      target_max: 2200,
      target_date: "2026-07-01",
      is_active: 1,
    })
  })

  it("soft-deletes a goal", () => {
    setObservationGoal(db, 2, "Weight", "daily_min", 50, null, "kg", null)
    deleteObservationGoal(db, 2, "Weight")
    expect(getObservationGoal(db, 2, "Weight")).toBeNull()
  })
})
