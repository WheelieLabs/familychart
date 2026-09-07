import Database from "better-sqlite3-multiple-ciphers"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  loadScheduleTimings,
  loadSlotEvaluatorConfig,
  toSlotEvaluatorConfig,
  PUSH_DELIVERY_WINDOW_MINUTES,
} from "@/lib/schedule/schedule-config"
import {
  SETTING_SCHEDULE_LEAD_MINUTES,
  SETTING_SCHEDULE_OVERDUE_OFFSET_MINUTES,
  SETTING_SCHEDULE_SLOT_ASSOCIATION_RADIUS_MINUTES,
  scheduleSettingDefaults,
} from "@/lib/settings/registry"

function createTestDb(): Database.Database {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE app_settings (
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (key)
    );
  `)
  return db
}

describe("loadScheduleTimings", () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    delete process.env.FC_SCHEDULE_LEAD_MINUTES
    delete process.env.FC_SCHEDULE_OVERDUE_OFFSET_MINUTES
    delete process.env.FC_SCHEDULE_SLOT_ASSOCIATION_RADIUS_MINUTES
    delete process.env.PUSH_OVERDUE_HOURS
  })

  afterEach(() => {
    delete process.env.FC_SCHEDULE_LEAD_MINUTES
    delete process.env.FC_SCHEDULE_OVERDUE_OFFSET_MINUTES
    delete process.env.FC_SCHEDULE_SLOT_ASSOCIATION_RADIUS_MINUTES
    delete process.env.PUSH_OVERDUE_HOURS
    db?.close()
  })

  it("returns registry defaults when unset", () => {
    expect(loadScheduleTimings(db)).toEqual(scheduleSettingDefaults())
  })

  it("reads db overrides", () => {
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      SETTING_SCHEDULE_LEAD_MINUTES,
      "45",
      Date.now(),
    )
    expect(loadScheduleTimings(db).leadMinutes).toBe(45)
  })

  it("honours legacy PUSH_OVERDUE_HOURS when registry env is unset", () => {
    process.env.PUSH_OVERDUE_HOURS = "1.5"
    expect(loadScheduleTimings(db).overdueOffsetMinutes).toBe(90)
  })

  it("prefers FC_SCHEDULE_OVERDUE_OFFSET_MINUTES over legacy env", () => {
    process.env.PUSH_OVERDUE_HOURS = "2"
    process.env.FC_SCHEDULE_OVERDUE_OFFSET_MINUTES = "45"
    expect(loadScheduleTimings(db).overdueOffsetMinutes).toBe(45)
  })
})

describe("toSlotEvaluatorConfig", () => {
  it("derives grace from overdue offset plus fixed push window", () => {
    const cfg = toSlotEvaluatorConfig({
      leadMinutes: 60,
      overdueOffsetMinutes: 30,
      slotAssociationRadiusMinutes: 60,
    })
    expect(cfg.slotWindowMs).toBe(PUSH_DELIVERY_WINDOW_MINUTES * 60_000)
    expect(cfg.overdueOffsetMs).toBe(30 * 60_000)
    expect(cfg.graceMs).toBe((30 + PUSH_DELIVERY_WINDOW_MINUTES) * 60_000)
  })

  it("loadSlotEvaluatorConfig matches defaults", () => {
    const db = createTestDb()
    const cfg = loadSlotEvaluatorConfig(db)
    expect(cfg.leadMs).toBe(60 * 60_000)
    expect(cfg.overdueOffsetMs).toBe(30 * 60_000)
    db.close()
  })
})
