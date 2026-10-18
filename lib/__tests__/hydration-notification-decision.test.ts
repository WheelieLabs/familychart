import Database from "better-sqlite3-multiple-ciphers"
import { describe, expect, it } from "vitest"
import { applyBaselineSchema } from "@/lib/db"
import { USER_TIMEZONE_KEY } from "@/lib/hydration/hydration-timezone"
import {
  HYDRATION_KEY_ACTIVE_END,
  HYDRATION_KEY_ACTIVE_START,
  HYDRATION_KEY_GLASS_SIZE,
  HYDRATION_KEY_LAST_NUDGE_AT,
  HYDRATION_KEY_MUTED_UNTIL,
} from "@/lib/hydration/hydration-config"
import {
  decideHydrationNotification,
  hydrationNudgeOutstanding,
  planHydrationNotification,
} from "@/lib/hydration/hydration-notification"
import { computeHydrationPacing } from "@/lib/hydration/hydration-pacing"

// 07:00 to 21:00, 2000 ml in 250 ml glasses: 1000 ml expected by 14:00.
const pacingAt = (consumed: number, nowLocalMinutes = 14 * 60) =>
  computeHydrationPacing({ activeStart: 420, activeEnd: 1260, glassSize: 250, target: 2000, consumed, nowLocalMinutes })

describe("decideHydrationNotification", () => {
  it("clears when the person has met the goal", () => {
    expect(decideHydrationNotification({ mutedToday: false, pacing: pacingAt(2000), nudgeOutstanding: true })).toEqual({ kind: "clear" })
  })

  it("clears when the person is back on pace", () => {
    expect(decideHydrationNotification({ mutedToday: false, pacing: pacingAt(1000), nudgeOutstanding: true })).toEqual({ kind: "clear" })
  })

  it("updates with the new count when still behind", () => {
    expect(decideHydrationNotification({ mutedToday: false, pacing: pacingAt(500), nudgeOutstanding: true })).toEqual({
      kind: "update",
      glassesNeededNow: 2,
    })
  })

  it("sends nothing when muted today, even if the person has caught up", () => {
    expect(decideHydrationNotification({ mutedToday: true, pacing: pacingAt(2000), nudgeOutstanding: true })).toEqual({ kind: "none" })
    expect(decideHydrationNotification({ mutedToday: true, pacing: pacingAt(500), nudgeOutstanding: true })).toEqual({ kind: "none" })
  })

  it("sends nothing when no nudge is outstanding, so a reading never creates a notification", () => {
    expect(decideHydrationNotification({ mutedToday: false, pacing: pacingAt(500), nudgeOutstanding: false })).toEqual({ kind: "none" })
    expect(decideHydrationNotification({ mutedToday: false, pacing: pacingAt(2000), nudgeOutstanding: false })).toEqual({ kind: "none" })
  })

  it("sends nothing before the window opens or after it closes", () => {
    expect(decideHydrationNotification({ mutedToday: false, pacing: pacingAt(0, 5 * 60), nudgeOutstanding: true })).toEqual({ kind: "none" })
    expect(decideHydrationNotification({ mutedToday: false, pacing: pacingAt(500, 22 * 60), nudgeOutstanding: true })).toEqual({ kind: "none" })
  })

  it("sends nothing without a goal", () => {
    expect(decideHydrationNotification({ mutedToday: false, pacing: null, nudgeOutstanding: true })).toEqual({ kind: "none" })
  })
})

describe("hydrationNudgeOutstanding", () => {
  const NOW = Date.parse("2025-01-15T14:00:00.000Z")
  const HOUR = 3_600_000

  it("is true when a nudge went out after the last reading", () => {
    expect(hydrationNudgeOutstanding({ lastNudgeAtMs: NOW - HOUR, lastRecordAtMs: NOW - 2 * HOUR, nowMs: NOW })).toBe(true)
    expect(hydrationNudgeOutstanding({ lastNudgeAtMs: NOW - HOUR, lastRecordAtMs: null, nowMs: NOW })).toBe(true)
  })

  it("is false once a reading came after the nudge, or when none was sent", () => {
    expect(hydrationNudgeOutstanding({ lastNudgeAtMs: NOW - 2 * HOUR, lastRecordAtMs: NOW - HOUR, nowMs: NOW })).toBe(false)
    expect(hydrationNudgeOutstanding({ lastNudgeAtMs: null, lastRecordAtMs: null, nowMs: NOW })).toBe(false)
  })

  it("is false for a nudge more than a day old", () => {
    expect(hydrationNudgeOutstanding({ lastNudgeAtMs: NOW - 25 * HOUR, lastRecordAtMs: null, nowMs: NOW })).toBe(false)
  })
})

describe("planHydrationNotification", () => {
  const NOW = Date.parse("2025-01-15T14:00:00.000Z")
  const person = { id: 1, account_uid: "user-1" }

  function setup(opts: { consumedMl: number; nudgedAtMs?: number; mutedUntil?: string; goal?: boolean }) {
    const db = new Database(":memory:")
    applyBaselineSchema(db)
    db.prepare("INSERT INTO people (id, name, account_uid) VALUES (1, 'Toby', 'user-1')").run()
    if (opts.goal !== false) {
      db.prepare(
        "INSERT INTO observation_goals (person_id, observation_type, goal_type, target_value, unit) VALUES (1, 'Hydration', 'daily_min', 2000, 'mL')",
      ).run()
    }
    const set = (key: string, value: string) =>
      db.prepare("INSERT INTO user_settings (user_uid, key, value, updated_at) VALUES ('user-1', ?, ?, 0)").run(key, value)
    set(USER_TIMEZONE_KEY, "Europe/London")
    set(HYDRATION_KEY_ACTIVE_START, "07:00")
    set(HYDRATION_KEY_ACTIVE_END, "21:00")
    set(HYDRATION_KEY_GLASS_SIZE, "250")
    if (opts.nudgedAtMs != null) set(HYDRATION_KEY_LAST_NUDGE_AT, String(opts.nudgedAtMs))
    if (opts.mutedUntil) set(HYDRATION_KEY_MUTED_UNTIL, opts.mutedUntil)
    if (opts.consumedMl > 0) {
      db.prepare(
        "INSERT INTO observations (person_id, observation_type, value, unit, recorded_at) VALUES (1, 'Hydration', ?, 'mL', '2025-01-15T13:50:00.000Z')",
      ).run(opts.consumedMl)
    }
    return db
  }
  const nudged = NOW - 30 * 60_000

  it("clears once the reading brings the person back on pace", () => {
    expect(planHydrationNotification(setup({ consumedMl: 1000, nudgedAtMs: nudged }), person, NOW)).toMatchObject({
      decision: { kind: "clear" },
      settingsUid: "user-1",
    })
  })

  it("updates with the new count while still behind", () => {
    expect(planHydrationNotification(setup({ consumedMl: 500, nudgedAtMs: nudged }), person, NOW).decision).toEqual({
      kind: "update",
      glassesNeededNow: 2,
    })
  })

  it("does nothing when muted today", () => {
    expect(
      planHydrationNotification(setup({ consumedMl: 1000, nudgedAtMs: nudged, mutedUntil: "2025-01-15" }), person, NOW).decision,
    ).toEqual({ kind: "none" })
  })

  it("does nothing when no nudge went out, or there is no goal, or no linked Account", () => {
    expect(planHydrationNotification(setup({ consumedMl: 500 }), person, NOW).decision).toEqual({ kind: "none" })
    expect(planHydrationNotification(setup({ consumedMl: 500, nudgedAtMs: nudged, goal: false }), person, NOW).decision).toEqual({ kind: "none" })
    expect(planHydrationNotification(setup({ consumedMl: 500, nudgedAtMs: nudged }), { id: 1, account_uid: null }, NOW).decision).toEqual({ kind: "none" })
  })
})
