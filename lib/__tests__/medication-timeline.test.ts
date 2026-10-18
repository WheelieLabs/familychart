import { describe, it, expect } from "vitest"
import {
  buildMedicationTimelineLane,
  isWithinTimelineWindow,
  TIMELINE_LOOKAHEAD_HOURS,
  TIMELINE_WINDOW_HOURS,
} from "@/lib/medication/medication-timeline"
import type { PrnEvalResult } from "@/lib/prn/prn-eval"

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0)
const H = 3_600_000
const iso = (hoursFromNow: number) => new Date(NOW + hoursFromNow * H).toISOString()

const quietPrn: PrnEvalResult = {
  atCap: false,
  coverageGap: false,
  cooldown: false,
  canDose: true,
  resetAtMs: null,
  availableAtMs: null,
  effectiveOffsetH: null,
}

function lane(over: Partial<Parameters<typeof buildMedicationTimelineLane>[0]> = {}) {
  return buildMedicationTimelineLane({
    medicationId: 7,
    name: "Paracetamol",
    doses: [],
    prn: null,
    scheduled: false,
    slots: [],
    nowMs: NOW,
    ...over,
  })
}

describe("buildMedicationTimelineLane — qualification", () => {
  it("is null with no dose in the window and nothing upcoming", () => {
    expect(lane()).toBeNull()
  })

  it("qualifies on a dose in the trailing window", () => {
    expect(lane({ doses: [{ id: 1, recorded_at: iso(-3), timing: null }] })).not.toBeNull()
  })

  it("ignores doses older than the window", () => {
    expect(lane({ doses: [{ id: 1, recorded_at: iso(-(TIMELINE_WINDOW_HOURS + 1)), timing: null }] })).toBeNull()
  })

  it("qualifies on an upcoming scheduled slot inside the lookahead", () => {
    expect(lane({ slots: [{ atMs: NOW + 2 * H, status: "upcoming" }] })).not.toBeNull()
  })

  it("ignores scheduled slots beyond the lookahead", () => {
    expect(lane({ slots: [{ atMs: NOW + (TIMELINE_LOOKAHEAD_HOURS + 1) * H, status: "upcoming" }] })).toBeNull()
  })

  it("qualifies on a PRN next-eligible instant ahead of now", () => {
    expect(
      lane({ prn: { ...quietPrn, cooldown: true, availableAtMs: NOW + 2 * H } }),
    ).not.toBeNull()
  })
})

describe("buildMedicationTimelineLane — taken markers", () => {
  it("emits one taken marker per dose with a Live Feed row id", () => {
    const l = lane({
      doses: [
        { id: 11, recorded_at: iso(-10), timing: null },
        { id: 12, recorded_at: iso(-2), timing: null },
      ],
    })!
    const taken = l.markers.filter((m) => m.kind === "taken")
    expect(taken.map((m) => m.feedRowId)).toEqual(["med:11", "med:12"])
  })

  it("marks a late dose through the shared medication flag, saying by how much", () => {
    const timing = { result: "late", offsetMinutes: 41, slotHhmm: "08:00" } as const
    const l = lane({ doses: [{ id: 1, recorded_at: iso(-4), timing }] })!
    expect(l.markers[0]).toMatchObject({ kind: "taken", timing: "late", flag: { level: "amber", label: "41 min late" } })
  })

  it("marks an early dose with its own state", () => {
    const timing = { result: "early", offsetMinutes: -38, slotHhmm: "16:00" } as const
    const l = lane({ doses: [{ id: 1, recorded_at: iso(-4), timing }] })!
    expect(l.markers[0]).toMatchObject({ kind: "taken", timing: "early", flag: { level: "info", label: "38 min early" } })
  })

  it("keeps an On time dose distinct from an untimed one, with no flag on either", () => {
    const onTime = { result: "on_time", offsetMinutes: 4, slotHhmm: "08:00" } as const
    const l = lane({
      doses: [
        { id: 1, recorded_at: iso(-4), timing: onTime },
        { id: 2, recorded_at: iso(-3), timing: null },
      ],
    })!
    expect(l.markers.map((m) => (m.kind === "taken" ? m.timing : "x"))).toEqual(["on_time", null])
    expect(l.markers.every((m) => m.flag === null)).toBe(true)
  })
})

describe("buildMedicationTimelineLane — scheduled slots", () => {
  it("emits upcoming and overdue markers", () => {
    const l = lane({
      scheduled: true,
      slots: [
        { atMs: NOW - 2 * H, status: "overdue" },
        { atMs: NOW + 4 * H, status: "upcoming" },
      ],
    })!
    expect(l.markers.map((m) => m.kind)).toEqual(["overdue", "upcoming"])
    expect(l.kind).toBe("scheduled")
  })

  it("emits a missed marker for a missed slot, and nothing for a slot a dose attached to", () => {
    const l = lane({
      slots: [
        { atMs: NOW - 6 * H, status: "missed" },
        { atMs: NOW - 3 * H, status: "resolved" },
        { atMs: NOW + 2 * H, status: "upcoming" },
      ],
    })!
    expect(l.markers.map((m) => m.kind)).toEqual(["missed", "upcoming"])
  })

  it("draws a slot line at every slot time in the window, resolved or not", () => {
    const l = lane({
      slots: [
        { atMs: NOW - 6 * H, status: "missed" },
        { atMs: NOW - 3 * H, status: "resolved" },
        { atMs: NOW + 2 * H, status: "upcoming" },
        { atMs: NOW - (TIMELINE_WINDOW_HOURS + 2) * H, status: "resolved" },
      ],
    })!
    expect(l.slotLines).toEqual([iso(-6), iso(-3), iso(2)])
  })

  it("treats a due slot as upcoming", () => {
    const l = lane({
      slots: [
        { atMs: NOW + 1 * H, status: "due" },
        { atMs: NOW + 2 * H, status: "overdue" },
      ],
    })!
    expect(l.markers.map((m) => m.kind)).toEqual(["upcoming", "overdue"])
  })

  it("drops slots older than the window", () => {
    expect(lane({ slots: [{ atMs: NOW - (TIMELINE_WINDOW_HOURS + 2) * H, status: "overdue" }] })).toBeNull()
  })
})

describe("buildMedicationTimelineLane — PRN bands", () => {
  const dose = { id: 1, recorded_at: iso(-2), timing: null }

  it("adds a cooldown band from the last dose to the available instant", () => {
    const l = lane({
      doses: [dose],
      prn: { ...quietPrn, cooldown: true, availableAtMs: NOW + 4 * H },
    })!
    expect(l.kind).toBe("prn")
    expect(l.cooldown).toEqual({ startIso: iso(-2), endIso: iso(4) })
    expect(l.markers.find((m) => m.kind === "next_eligible")?.atIso).toBe(iso(4))
  })

  it("adds the 24h-cap band when at cap or in a coverage gap, without a next-eligible marker at cap", () => {
    const l = lane({
      doses: [{ id: 1, recorded_at: iso(-20), timing: null }, dose],
      prn: { ...quietPrn, atCap: true, resetAtMs: NOW + 4 * H, availableAtMs: NOW + 3 * H },
    })!
    expect(l.capWindow).toEqual({ startIso: iso(-20), endIso: iso(4) })
    expect(l.markers.some((m) => m.kind === "next_eligible")).toBe(false)
    expect(l.atCap).toBe(true)
  })

  it("carries no bands when nothing is blocking", () => {
    const l = lane({ doses: [dose], prn: quietPrn })!
    expect(l.cooldown).toBeNull()
    expect(l.capWindow).toBeNull()
  })
})

describe("isWithinTimelineWindow", () => {
  it("covers the trailing 24h only", () => {
    expect(isWithinTimelineWindow(iso(-23), NOW)).toBe(true)
    expect(isWithinTimelineWindow(iso(-25), NOW)).toBe(false)
    expect(isWithinTimelineWindow(iso(1), NOW)).toBe(false)
  })
})
