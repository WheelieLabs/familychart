// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import {
  SETTING_SCHEDULE_LEAD_MINUTES,
  SETTING_SCHEDULE_OVERDUE_OFFSET_MINUTES,
  scheduleSettingDefaults,
} from "@/lib/settings/registry"
import { resolveSetting } from "@/lib/settings/resolver"
import type { SlotEvaluatorConfig } from "@/lib/schedule/schedule-slot-evaluator"

/**
 * Fixed push-delivery width (minutes): on-time push window, overdue-push window,
 * and history "late" label after a nominal slot. Not exposed in the settings registry.
 */
export const PUSH_DELIVERY_WINDOW_MINUTES = 30

export interface ScheduleTimings {
  leadMinutes: number
  overdueOffsetMinutes: number
}

function parseBoundedMinutes(value: string, fallback: number): number {
  const n = parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function resolveScheduleMinutes(
  db: Database.Database,
  key: string,
  fallback: number,
): number {
  const resolved = resolveSetting(db, key)
  if (resolved.source === "env" || resolved.source === "db") {
    return parseBoundedMinutes(resolved.value, fallback)
  }
  return fallback
}

/** Loads the two caregiver-tunable schedule timings from app_settings (with env fallbacks). */
export function loadScheduleTimings(db: Database.Database): ScheduleTimings {
  const defaults = scheduleSettingDefaults()
  return {
    leadMinutes: resolveScheduleMinutes(
      db,
      SETTING_SCHEDULE_LEAD_MINUTES,
      defaults.leadMinutes,
    ),
    overdueOffsetMinutes: resolveScheduleMinutes(
      db,
      SETTING_SCHEDULE_OVERDUE_OFFSET_MINUTES,
      defaults.overdueOffsetMinutes,
    ),
  }
}

/** Derives evaluator timing from registry timings + fixed push-delivery width. */
export function toSlotEvaluatorConfig(timings: ScheduleTimings): SlotEvaluatorConfig {
  const slotWindowMs = PUSH_DELIVERY_WINDOW_MINUTES * 60_000
  const overdueOffsetMs = timings.overdueOffsetMinutes * 60_000
  return {
    leadMs: timings.leadMinutes * 60_000,
    slotWindowMs,
    overdueOffsetMs,
    graceMs: overdueOffsetMs + slotWindowMs,
  }
}

export function loadSlotEvaluatorConfig(db: Database.Database): SlotEvaluatorConfig {
  return toSlotEvaluatorConfig(loadScheduleTimings(db))
}
