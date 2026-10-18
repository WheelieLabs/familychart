// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import {
  applyKeysetPage,
  daysAgo,
} from "@/lib/medication/medication-history"

describe("daysAgo", () => {
  it("subtracts whole calendar days from an ISO local date", () => {
    expect(daysAgo(30, "2024-03-15")).toBe("2024-02-14")
    expect(daysAgo(7, "2024-03-15")).toBe("2024-03-08")
  })
})

describe("applyKeysetPage", () => {
  const a = { id: 3, recorded_at: "2025-06-01T10:00:00.000Z" }
  const b = { id: 2, recorded_at: "2025-06-01T09:00:00.000Z" }
  const c = { id: 1, recorded_at: "2025-06-01T08:00:00.000Z" }

  it("replaces records and stores the next cursor on a first page", () => {
    expect(
      applyKeysetPage([a], { rows: [a, b], nextCursor: { ts: b.recorded_at, id: b.id } }, "replace"),
    ).toEqual({
      records: [a, b],
      nextCursor: { ts: "2025-06-01T09:00:00.000Z", id: 2 },
    })
  })

  it("appends the next page and advances the cursor", () => {
    expect(
      applyKeysetPage([a, b], { rows: [c], nextCursor: null }, "append"),
    ).toEqual({
      records: [a, b, c],
      nextCursor: null,
    })
  })
})
