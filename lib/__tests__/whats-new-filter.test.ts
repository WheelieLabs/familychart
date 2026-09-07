import { describe, expect, it } from "vitest"
import { filterWhatsNewEntries, semverGt, semverLte } from "@/lib/whats-new-filter"

describe("semverGt", () => {
  it("compares patch versions", () => {
    expect(semverGt("0.37.1", "0.37.0")).toBe(true)
    expect(semverGt("0.37.0", "0.37.1")).toBe(false)
  })

  it("compares minor and major versions", () => {
    expect(semverGt("0.37.0", "0.36.99")).toBe(true)
    expect(semverGt("1.0.0", "0.99.99")).toBe(true)
  })
})

describe("semverLte", () => {
  it("is the inverse of semverGt for ordered pairs", () => {
    expect(semverLte("0.36.0", "0.37.0")).toBe(true)
    expect(semverLte("0.38.0", "0.37.0")).toBe(false)
  })
})

describe("filterWhatsNewEntries", () => {
  const entries = [
    { version: "0.34.4", date: "2026-06-08", highlights: ["Favourites"] },
    { version: "0.36.0", date: "2026-06-10", highlights: ["A"] },
    { version: "0.37.0", date: "2026-06-20", highlights: ["B"] },
  ]

  it("returns entries after lastSeen up to appVersion", () => {
    expect(filterWhatsNewEntries(entries, "0.34.4", "0.37.0")).toEqual([
      entries[1],
      entries[2],
    ])
  })

  it("excludes entries above appVersion", () => {
    expect(filterWhatsNewEntries(entries, "0.34.4", "0.36.0")).toEqual([entries[1]])
  })

  it("returns empty when lastSeen is current", () => {
    expect(filterWhatsNewEntries(entries, "0.37.0", "0.37.0")).toEqual([])
  })
})
