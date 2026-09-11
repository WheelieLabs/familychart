import { describe, it, expect } from "vitest"
import {
  evaluateScheduledSlot,
  isSlotClearedByDose,
  resolveSlotMs,
  findNextSuppressibleSlot,
  collectDueScheduledSlots,
  type SlotEvaluatorConfig,
  type ScheduleAssemblyRow,
} from "@/lib/schedule/schedule-slot-evaluator"
import { PUSH_DELIVERY_WINDOW_MINUTES, toSlotEvaluatorConfig } from "@/lib/schedule/schedule-config"
import { scheduleSettingDefaults } from "@/lib/settings/registry"
import type { CalendarContext } from "@/lib/calendar-context"

const SLOT_MS = new Date("2025-01-15T10:00:00.000Z").getTime()
const SLOT_WINDOW_MS = PUSH_DELIVERY_WINDOW_MINUTES * 60 * 1000
const cfg = toSlotEvaluatorConfig(scheduleSettingDefaults())
const SCHEDULE_LEAD_MS = cfg.leadMs
const SLOT_OVERDUE_OFFSET_MS = cfg.overdueOffsetMs
const SCHEDULE_GRACE_MS = cfg.graceMs

// ── resolveSlotMs ────────────────────────────────────────────────────────────

describe("resolveSlotMs", () => {
  it("uses ianaLocalYmdHmToUtcMs when ianaTz is set", () => {
    const ctx: CalendarContext = { ymd: "2025-01-15", offsetMinutes: 0, ianaTz: "UTC" }
    const ms = resolveSlotMs(ctx, "2025-01-15", "10:00")
    expect(ms).toBe(new Date("2025-01-15T10:00:00.000Z").getTime())
  })

  it("uses localCalendarYmdHmToUtcMs (offset path) when ianaTz is null", () => {
    const ctx: CalendarContext = { ymd: "2025-01-15", offsetMinutes: -600, ianaTz: null }
    const ms = resolveSlotMs(ctx, "2025-01-15", "20:00")
    expect(ms).toBe(new Date("2025-01-15T10:00:00.000Z").getTime())
  })

  it("returns same result via IANA and matching offset for a non-DST timezone", () => {
    const ianaCtx: CalendarContext = { ymd: "2025-01-15", offsetMinutes: -600, ianaTz: "Australia/Brisbane" }
    const offsetCtx: CalendarContext = { ymd: "2025-01-15", offsetMinutes: -600, ianaTz: null }
    const msIana = resolveSlotMs(ianaCtx, "2025-01-15", "08:00")
    const msOffset = resolveSlotMs(offsetCtx, "2025-01-15", "08:00")
    expect(msIana).toBe(msOffset)
  })
})

// ── evaluateScheduledSlot ────────────────────────────────────────────────────

describe("evaluateScheduledSlot — inactive windows", () => {
  it("is inactive before the upcoming window", () => {
    const nowMs = SLOT_MS - SCHEDULE_LEAD_MS - 1
    expect(evaluateScheduledSlot(SLOT_MS, nowMs, false, cfg)).toBe("inactive")
  })

  it("is inactive after all windows close (past overdue push + grace)", () => {
    const nowMs = SLOT_MS + SLOT_OVERDUE_OFFSET_MS + SLOT_WINDOW_MS + 1
    expect(evaluateScheduledSlot(SLOT_MS, nowMs, false, cfg)).toBe("inactive")
  })
})

describe("evaluateScheduledSlot — upcoming", () => {
  it("is upcoming at the start of the lead window", () => {
    const nowMs = SLOT_MS - SCHEDULE_LEAD_MS
    expect(evaluateScheduledSlot(SLOT_MS, nowMs, false, cfg)).toBe("upcoming")
  })

  it("is upcoming 1 ms before slot time", () => {
    const nowMs = SLOT_MS - 1
    expect(evaluateScheduledSlot(SLOT_MS, nowMs, false, cfg)).toBe("upcoming")
  })
})

describe("evaluateScheduledSlot — due (on-time push window)", () => {
  it("is due at slot time", () => {
    expect(evaluateScheduledSlot(SLOT_MS, SLOT_MS, false, cfg)).toBe("due")
  })

  it("is due at the end of the slot window", () => {
    const nowMs = SLOT_MS + SLOT_WINDOW_MS
    expect(evaluateScheduledSlot(SLOT_MS, nowMs, false, cfg)).toBe("due")
  })

  it("is not due 1 ms after the slot window closes", () => {
    const nowMs = SLOT_MS + SLOT_WINDOW_MS + 1
    expect(evaluateScheduledSlot(SLOT_MS, nowMs, false, cfg)).not.toBe("due")
  })
})

describe("evaluateScheduledSlot — overdue_push at default 30 min offset", () => {
  it("enters overdue_push immediately after the on-time window when offset equals push width", () => {
    const nowMs = SLOT_MS + SLOT_WINDOW_MS + 1
    expect(evaluateScheduledSlot(SLOT_MS, nowMs, false, cfg)).toBe("overdue_push")
  })

  it("is overdue_push at the start of the overdue push window", () => {
    const nowMs = SLOT_MS + SLOT_OVERDUE_OFFSET_MS
    expect(evaluateScheduledSlot(SLOT_MS, nowMs, false, cfg)).toBe("due")
    expect(evaluateScheduledSlot(SLOT_MS, nowMs + 1, false, cfg)).toBe("overdue_push")
  })

  it("is overdue_push at the end of the overdue push window", () => {
    const nowMs = SLOT_MS + SLOT_OVERDUE_OFFSET_MS + SLOT_WINDOW_MS
    expect(evaluateScheduledSlot(SLOT_MS, nowMs, false, cfg)).toBe("overdue_push")
  })
})

describe("evaluateScheduledSlot — grace window", () => {
  it("grace covers through the end of the overdue push window", () => {
    expect(SCHEDULE_GRACE_MS).toBeGreaterThanOrEqual(SLOT_OVERDUE_OFFSET_MS + SLOT_WINDOW_MS)
  })
})

describe("evaluateScheduledSlot — suppressed", () => {
  it("is suppressed in upcoming window when isSuppressed = true", () => {
    const nowMs = SLOT_MS - 30 * 60 * 1000
    expect(evaluateScheduledSlot(SLOT_MS, nowMs, true, cfg)).toBe("suppressed")
  })

  it("is suppressed in due window when isSuppressed = true", () => {
    const nowMs = SLOT_MS + 5 * 60 * 1000
    expect(evaluateScheduledSlot(SLOT_MS, nowMs, true, cfg)).toBe("suppressed")
  })

  it("is suppressed in overdue_push window when isSuppressed = true", () => {
    const nowMs = SLOT_MS + SLOT_OVERDUE_OFFSET_MS + 5 * 60 * 1000
    expect(evaluateScheduledSlot(SLOT_MS, nowMs, true, cfg)).toBe("suppressed")
  })

  it("is inactive (not suppressed) outside all windows even when isSuppressed = true", () => {
    const nowMs = SLOT_MS - SCHEDULE_LEAD_MS - 1
    expect(evaluateScheduledSlot(SLOT_MS, nowMs, true, cfg)).toBe("inactive")
  })
})

// ── isSlotClearedByDose ───────────────────────────────────────────────

describe("isSlotClearedByDose", () => {
  it("is false when no doses are supplied", () => {
    expect(isSlotClearedByDose([], SLOT_MS, cfg)).toBe(false)
  })

  it("clears the slot for a dose recorded at slot time", () => {
    expect(isSlotClearedByDose([SLOT_MS], SLOT_MS, cfg)).toBe(true)
  })

  it("clears an overdue slot for a dose recorded after the slot (within grace)", () => {
    const dose = SLOT_MS + 45 * 60 * 1000
    expect(isSlotClearedByDose([dose], SLOT_MS, cfg)).toBe(true)
  })

  it("clears an upcoming slot for a dose recorded just before it (within lead)", () => {
    const dose = SLOT_MS - 30 * 60 * 1000
    expect(isSlotClearedByDose([dose], SLOT_MS, cfg)).toBe(true)
  })

  it("does not clear when the dose is before the lead window opens", () => {
    const dose = SLOT_MS - SCHEDULE_LEAD_MS - 1
    expect(isSlotClearedByDose([dose], SLOT_MS, cfg)).toBe(false)
  })

  it("does not clear when the dose is after the grace window closes", () => {
    const dose = SLOT_MS + SCHEDULE_GRACE_MS + 1
    expect(isSlotClearedByDose([dose], SLOT_MS, cfg)).toBe(false)
  })

  it("clears when any one of several doses falls in the window", () => {
    const doses = [SLOT_MS - 10 * 86_400_000, SLOT_MS + 10 * 60 * 1000, SLOT_MS + 10 * 86_400_000]
    expect(isSlotClearedByDose(doses, SLOT_MS, cfg)).toBe(true)
  })

  it("ignores non-finite dose timestamps", () => {
    expect(isSlotClearedByDose([NaN], SLOT_MS, cfg)).toBe(false)
  })
})

// ── findNextSuppressibleSlot ─────────────────────────────────────────────────

describe("findNextSuppressibleSlot", () => {
  const dailySchedule = {
    scheduleTimes: ["08:00", "14:00", "20:00"],
    scheduleFrequency: { kind: "daily" as const },
    scheduleStartDate: null,
    scheduleEndDate: null,
  }

  it("returns the first slot strictly after the recorded time (offset path)", () => {
    const ctx: CalendarContext = { ymd: "2025-01-15", offsetMinutes: 0, ianaTz: null }
    const recordedMs = new Date("2025-01-15T09:00:00.000Z").getTime()
    const result = findNextSuppressibleSlot(recordedMs, dailySchedule, ctx)
    expect(result?.hhmm).toBe("14:00")
    expect(result?.slotMs).toBe(new Date("2025-01-15T14:00:00.000Z").getTime())
  })

  it("does not return today's earliest slot for a previous-day recorded_at", () => {
    const ctx: CalendarContext = { ymd: "2025-01-15", offsetMinutes: 0, ianaTz: null }
    const recordedMs = new Date("2025-01-14T12:00:00.000Z").getTime()
    expect(findNextSuppressibleSlot(recordedMs, dailySchedule, ctx, cfg)).toBeNull()
  })

  it("still returns a next-day slot when recorded_at falls in that slot's lead window", () => {
    const overnight = { ...dailySchedule, scheduleTimes: ["00:30"] }
    const ctx: CalendarContext = { ymd: "2025-01-15", offsetMinutes: 0, ianaTz: null }
    const recordedMs = new Date("2025-01-14T23:45:00.000Z").getTime()
    const result = findNextSuppressibleSlot(recordedMs, overnight, ctx, cfg)
    expect(result?.hhmm).toBe("00:30")
    expect(result?.slotMs).toBe(new Date("2025-01-15T00:30:00.000Z").getTime())
  })

  it("goes through resolveSlotMs's IANA path when ianaTz is set", () => {
    const ctx: CalendarContext = { ymd: "2025-01-15", offsetMinutes: 0, ianaTz: "Australia/Brisbane" }
    // Brisbane is UTC+10, no DST — 08:00 local is 22:00 UTC the previous day
    const recordedMs = new Date("2025-01-14T23:00:00.000Z").getTime()
    const result = findNextSuppressibleSlot(recordedMs, dailySchedule, ctx)
    expect(result?.hhmm).toBe("14:00")
    expect(result?.slotMs).toBe(resolveSlotMs(ctx, "2025-01-15", "14:00"))
  })

  it("returns null when no slot remains after the recorded time", () => {
    const ctx: CalendarContext = { ymd: "2025-01-15", offsetMinutes: 0, ianaTz: null }
    const recordedMs = new Date("2025-01-15T21:00:00.000Z").getTime()
    expect(findNextSuppressibleSlot(recordedMs, dailySchedule, ctx)).toBeNull()
  })

  it("returns null when the schedule is inactive on the calendar day (weekly, wrong weekday)", () => {
    const ctx: CalendarContext = { ymd: "2025-01-15", offsetMinutes: 0, ianaTz: null } // 2025-01-15 is a Wednesday
    const weeklySchedule = {
      ...dailySchedule,
      scheduleFrequency: { kind: "weekly" as const, weekdays: [1] }, // Monday only
    }
    expect(findNextSuppressibleSlot(new Date("2025-01-15T00:00:00.000Z").getTime(), weeklySchedule, ctx)).toBeNull()
  })

  it("returns null when the schedule day is before scheduleStartDate", () => {
    const ctx: CalendarContext = { ymd: "2025-01-15", offsetMinutes: 0, ianaTz: null }
    const notYetStarted = { ...dailySchedule, scheduleStartDate: "2025-02-01" }
    expect(findNextSuppressibleSlot(new Date("2025-01-15T00:00:00.000Z").getTime(), notYetStarted, ctx)).toBeNull()
  })

  it("returns null for a null scheduleFrequency", () => {
    const ctx: CalendarContext = { ymd: "2025-01-15", offsetMinutes: 0, ianaTz: null }
    const noFreq = { ...dailySchedule, scheduleFrequency: null }
    expect(findNextSuppressibleSlot(new Date("2025-01-15T00:00:00.000Z").getTime(), noFreq, ctx)).toBeNull()
  })

  it("skips unparseable time strings without crashing", () => {
    const ctx: CalendarContext = { ymd: "2025-01-15", offsetMinutes: 0, ianaTz: null }
    // "08:00" sorts before "not-a-time"; both are at/before recordedMs's effective position,
    // so the only real slot is already past and the invalid string must be skipped, not thrown.
    const messy = { ...dailySchedule, scheduleTimes: ["08:00", "not-a-time"] }
    const recordedMs = new Date("2025-01-15T09:00:00.000Z").getTime()
    expect(findNextSuppressibleSlot(recordedMs, messy, ctx)).toBeNull()
  })
})

// ── collectDueScheduledSlots ─────────────────────────────────────────────────

describe("collectDueScheduledSlots", () => {
  const todayYmd = "2025-01-15" // matches SLOT_MS = 2025-01-15T10:00:00Z
  const yesterdayYmd = "2025-01-14"
  const tomorrowYmd = "2025-01-16"

  function row(overrides: Partial<ScheduleAssemblyRow> = {}): ScheduleAssemblyRow {
    return {
      personMedicationId: 1,
      personId: 1,
      medicationId: 1,
      scheduleTimesRaw: JSON.stringify(["10:00"]),
      scheduleSlotsRaw: null,
      scheduleFrequencyRaw: JSON.stringify({ kind: "daily" }),
      scheduleStartDate: null,
      scheduleEndDate: null,
      medDefaultDosage: null,
      calCtx: { ymd: todayYmd, offsetMinutes: 0, ianaTz: null },
      ...overrides,
    }
  }

  const noSuppression = () => false
  const noDoses = () => []

  it("finds a due slot for a single-day (cron-style) window", () => {
    const result = collectDueScheduledSlots([row()], [todayYmd], SLOT_MS, cfg, noSuppression, noDoses)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      personMedicationId: 1, personId: 1, medicationId: 1,
      ymd: todayYmd, hhmm: "10:00", scheduledTime: "10:00", slotMs: SLOT_MS, status: "due",
    })
  })

  it("only surfaces the active day's slot across a multi-day (dashboard-style) window", () => {
    const result = collectDueScheduledSlots(
      [row()], [yesterdayYmd, todayYmd, tomorrowYmd], SLOT_MS, cfg, noSuppression, noDoses,
    )
    // yesterday/tomorrow's 10:00 slots are far outside every window relative to nowMs=SLOT_MS
    expect(result.map(r => r.ymd)).toEqual([todayYmd])
  })

  it("excludes inactive and suppressed slots", () => {
    const nowMs = SLOT_MS - SCHEDULE_LEAD_MS - 1 // before any window opens
    expect(collectDueScheduledSlots([row()], [todayYmd], nowMs, cfg, noSuppression, noDoses)).toEqual([])

    const suppressed = collectDueScheduledSlots(
      [row()], [todayYmd], SLOT_MS, cfg, () => true, noDoses,
    )
    expect(suppressed).toEqual([])
  })

  it("excludes a slot cleared by a recorded dose in its window", () => {
    const result = collectDueScheduledSlots(
      [row()], [todayYmd], SLOT_MS, cfg, noSuppression, () => [SLOT_MS],
    )
    expect(result).toEqual([])
  })

  it("skips a weekly-scheduled row on an inactive weekday", () => {
    // 2025-01-15 is a Wednesday (3); weekly schedule only active on Monday (1)
    const weeklyRow = row({ scheduleFrequencyRaw: JSON.stringify({ kind: "weekly", weekdays: [1] }) })
    expect(collectDueScheduledSlots([weeklyRow], [todayYmd], SLOT_MS, cfg, noSuppression, noDoses)).toEqual([])
  })

  it("skips a row with no schedule times", () => {
    const emptyRow = row({ scheduleTimesRaw: null })
    expect(collectDueScheduledSlots([emptyRow], [todayYmd], SLOT_MS, cfg, noSuppression, noDoses)).toEqual([])
  })

  it("works with an offset-only CalendarContext (no ianaTz — dashboard's lenient fallback)", () => {
    const offsetRow = row({ calCtx: { ymd: todayYmd, offsetMinutes: -600, ianaTz: null } })
    // 10:00 local at offset -600 (UTC+10) is 00:00 UTC
    const localSlotMs = new Date("2025-01-15T00:00:00.000Z").getTime()
    const result = collectDueScheduledSlots([offsetRow], [todayYmd], localSlotMs, cfg, noSuppression, noDoses)
    expect(result).toHaveLength(1)
    expect(result[0]!.slotMs).toBe(localSlotMs)
    expect(result[0]!.status).toBe("due")
  })

  it("resolves scheduledDosage via schedule_slots override, falling back to medDefaultDosage", () => {
    const withOverride = row({
      scheduleSlotsRaw: JSON.stringify([{ time: "10:00", dosage: 2.5 }]),
      medDefaultDosage: 1,
    })
    const [withOverrideResult] = collectDueScheduledSlots(
      [withOverride], [todayYmd], SLOT_MS, cfg, noSuppression, noDoses,
    )
    expect(withOverrideResult!.scheduledDosage).toBe(2.5)

    const fallbackOnly = row({ medDefaultDosage: 3 })
    const [fallbackResult] = collectDueScheduledSlots(
      [fallbackOnly], [todayYmd], SLOT_MS, cfg, noSuppression, noDoses,
    )
    expect(fallbackResult!.scheduledDosage).toBe(3)
  })

  it("routes suppression and dose-clearance lookups through the row's own personMedicationId/personId/medicationId", () => {
    const rowA = row({ personMedicationId: 1, personId: 1, medicationId: 1 })
    const rowB = row({ personMedicationId: 2, personId: 2, medicationId: 2 })
    const result = collectDueScheduledSlots(
      [rowA, rowB],
      [todayYmd],
      SLOT_MS,
      cfg,
      pmId => pmId === 1, // suppress only rowA
      noDoses,
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.personMedicationId).toBe(2)
  })
})

describe("evaluateScheduledSlot — configurable windows", () => {
  it("respects custom leadMs", () => {
    const custom: SlotEvaluatorConfig = { ...cfg, leadMs: 10 * 60 * 1000 }
    const nowMs = SLOT_MS - 15 * 60 * 1000
    expect(evaluateScheduledSlot(SLOT_MS, nowMs, false, cfg)).toBe("upcoming")
    expect(evaluateScheduledSlot(SLOT_MS, nowMs, false, custom)).toBe("inactive")
  })

  it("respects custom overdueOffsetMs with a grace gap", () => {
    const longOffset: SlotEvaluatorConfig = {
      ...cfg,
      overdueOffsetMs: 2 * 60 * 60 * 1000,
      graceMs: 2 * 60 * 60 * 1000 + SLOT_WINDOW_MS,
    }
    const custom: SlotEvaluatorConfig = { ...longOffset, overdueOffsetMs: 60 * 60 * 1000, graceMs: 90 * 60 * 1000 }
    const nowMs = SLOT_MS + 70 * 60 * 1000
    expect(evaluateScheduledSlot(SLOT_MS, nowMs, false, longOffset)).toBe("overdue")
    expect(evaluateScheduledSlot(SLOT_MS, nowMs, false, custom)).toBe("overdue_push")
  })
})
