import { afterEach, describe, expect, it } from "vitest"
import { relativeTimeLabel, timelineMidnights, timelineTicks } from "@/lib/medication/timeline-axis"

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()

describe("timelineTicks", () => {
  it("labels every third local hour and flags midnight", () => {
    const ticks = timelineTicks(local(2026, 10, 9, 10, 30), local(2026, 10, 10, 4, 30))
    expect(ticks.map(t => new Date(t.atMs).getHours())).toEqual([12, 15, 18, 21, 0, 3])
    expect(ticks.filter(t => t.midnight).map(t => t.atMs)).toEqual([local(2026, 10, 10)])
  })

  it("includes ticks exactly on the window edges", () => {
    const ticks = timelineTicks(local(2026, 10, 9, 9), local(2026, 10, 9, 15))
    expect(ticks.map(t => new Date(t.atMs).getHours())).toEqual([9, 12, 15])
  })

  it("finds two midnights in a 30 hour window", () => {
    const start = local(2026, 10, 9, 23)
    expect(timelineMidnights(start - 0, start + 30 * 3_600_000)).toEqual([local(2026, 10, 10), local(2026, 10, 11)])
  })

  it("has no midnight when the window sits inside one day", () => {
    expect(timelineMidnights(local(2026, 10, 9, 6), local(2026, 10, 9, 20))).toEqual([])
  })

  describe("across a DST change", () => {
    const tz = process.env.TZ
    afterEach(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz })

    it("keeps labelled hours on the wall clock and never repeats a tick", () => {
      // US spring-forward: 2026-03-08, 02:00 does not exist in America/New_York.
      process.env.TZ = "America/New_York"
      const ticks = timelineTicks(local(2026, 3, 7, 20), local(2026, 3, 8, 12))
      const hours = ticks.map(t => new Date(t.atMs).getHours())
      expect(hours).toEqual([21, 0, 3, 6, 9, 12])
      expect(new Set(ticks.map(t => t.atMs)).size).toBe(ticks.length)
    })
  })
})

describe("relativeTimeLabel", () => {
  const now = 1_000_000_000_000
  it.each([
    [now - (3 * 60 + 20) * 60_000, "3 h 20 min ago"],
    [now - 2 * 3_600_000, "2 h ago"],
    [now - 12 * 60_000, "12 min ago"],
    [now + 40 * 60_000, "in 40 min"],
    [now + 90 * 60_000, "in 1 h 30 min"],
    [now + 20_000, "just now"],
    [now - 29_000, "just now"],
  ])("%#", (at, expected) => {
    expect(relativeTimeLabel(at, now)).toBe(expected)
  })
})
