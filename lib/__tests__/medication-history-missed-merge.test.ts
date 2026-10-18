import { describe, expect, it } from "vitest"
import { mergeMissedIntoRecords } from "@/lib/medication/medication-history"
import type { MedRecord } from "@/lib/medication/medication-history"
import type { DoseMissedSummary } from "@/lib/medication/dose-missed-history"

const rec = (id: number, recorded_at: string): MedRecord => ({
  id, medication_name: "Ritalin", recorded_at, dosage: null, dosage_unit: null, comments: null,
})
const missed = (id: string, recorded_at: string): DoseMissedSummary => ({
  id, person_id: 1, medication_name: "Ritalin", recorded_at, cause: "timed_out",
})

describe("mergeMissedIntoRecords", () => {
  it("interleaves Missed slots with doses, newest first", () => {
    const rows = mergeMissedIntoRecords(
      [rec(2, "2026-08-05T12:00:00Z"), rec(1, "2026-08-03T12:00:00Z")],
      [missed("slot:9", "2026-08-04T08:00:00Z")],
      null,
    )
    expect(rows.map(r => (r.kind === "dose" ? `dose:${r.record.id}` : `missed:${r.missed.id}`))).toEqual([
      "dose:2", "missed:slot:9", "dose:1",
    ])
  })

  it("holds back Missed slots older than the last loaded dose while more doses remain", () => {
    const rows = mergeMissedIntoRecords(
      [rec(2, "2026-08-05T12:00:00Z")],
      [missed("slot:9", "2026-08-04T08:00:00Z"), missed("slot:10", "2026-08-06T08:00:00Z")],
      { ts: "2026-08-05T12:00:00Z", id: 2 },
    )
    expect(rows.map(r => (r.kind === "missed" ? r.missed.id : `dose:${r.record.id}`))).toEqual(["slot:10", "dose:2"])
  })

  it("shows every Missed slot once the last page of doses is loaded", () => {
    const rows = mergeMissedIntoRecords([], [missed("slot:9", "2026-08-04T08:00:00Z")], null)
    expect(rows).toHaveLength(1)
  })
})
