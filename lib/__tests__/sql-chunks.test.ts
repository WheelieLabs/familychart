// SPDX-License-Identifier: AGPL-3.0-only

import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyBaselineSchema } from "@/lib/db"
import { loadDoseTimingByRecord } from "@/lib/schedule/slot-outcome-reads"
import { loadSlotOutcomes } from "@/lib/schedule/slot-outcomes"
import { chunkItems, runInChunks } from "@/lib/sql-chunks"

describe("chunkItems and runInChunks", () => {
  it("splits in order and gives nothing for an empty list", () => {
    expect(chunkItems([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunkItems([], 2)).toEqual([])
  })

  it("runs once per chunk and concatenates the results", () => {
    const sizes: number[] = []
    const out = runInChunks([1, 2, 3, 4, 5], chunk => (sizes.push(chunk.length), chunk.map(n => n * 10)), 2)
    expect(sizes).toEqual([2, 2, 1])
    expect(out).toEqual([10, 20, 30, 40, 50])
  })
})

describe("slot outcome reads with more than 1000 ids", () => {
  let db: Database.Database
  const boundCounts: number[] = []

  beforeEach(() => {
    db = new Database(":memory:")
    db.pragma("foreign_keys = ON")
    applyBaselineSchema(db)
    db.prepare("INSERT INTO people (id, name) VALUES (1, 'Alice')").run()
    db.prepare("INSERT INTO medications (id, name, default_dosage, dosage_unit) VALUES (1, 'Amoxicillin', 1, 'Tabs')").run()
    const insertDose = db.prepare(
      "INSERT INTO medication_records (id, person_id, medication_id, recorded_at, dosage, dosage_unit) VALUES (?, 1, 1, '2025-01-15T08:00:00.000Z', 1, 'Tabs')",
    )
    const insertOutcome = db.prepare(
      `INSERT INTO slot_outcomes (person_medication_id, local_ymd, slot_hhmm, result, offset_minutes, medication_record_id)
       VALUES (1, ?, ?, 'on_time', 0, ?)`,
    )
    db.prepare("INSERT INTO person_medications (id, person_id, medication_id) VALUES (1, 1, 1)").run()
    for (let i = 1; i <= 1200; i++) {
      insertDose.run(i)
      insertOutcome.run("2025-01-15", `${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`, i)
    }
    boundCounts.length = 0
    const realPrepare = db.prepare.bind(db)
    vi.spyOn(db, "prepare").mockImplementation(((sql: string) => {
      const stmt = realPrepare(sql)
      const realAll = stmt.all.bind(stmt)
      stmt.all = ((...args: unknown[]) => (boundCounts.push(args.length), realAll(...args))) as typeof stmt.all
      return stmt
    }) as typeof db.prepare)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
  })

  it("loadDoseTimingByRecord finds every dose without binding more than 500 ids a statement", () => {
    const ids = Array.from({ length: 1200 }, (_, i) => i + 1)
    expect(loadDoseTimingByRecord(db, ids).size).toBe(1200)
    expect(Math.max(...boundCounts)).toBeLessThanOrEqual(500)
  })

  it("loadSlotOutcomes finds every outcome, in day then slot order, without binding more than 500 variables a statement", () => {
    const pmIds = Array.from({ length: 1100 }, (_, i) => i + 1)
    const ymds = Array.from({ length: 700 }, (_, i) => `2025-01-${String((i % 28) + 1).padStart(2, "0")}-${i}`)
    ymds.push("2025-01-15")
    const outcomes = loadSlotOutcomes(db, pmIds, ymds)
    expect(outcomes).toHaveLength(1200)
    expect(outcomes.map(o => o.slotHhmm)).toEqual([...outcomes.map(o => o.slotHhmm)].sort())
    expect(Math.max(...boundCounts)).toBeLessThanOrEqual(500)
  })
})
