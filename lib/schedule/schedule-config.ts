// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import {
  SETTING_SCHEDULE_LEAD_MINUTES,
  SETTING_SCHEDULE_OVERDUE_OFFSET_MINUTES,
  SETTING_SCHEDULE_SLOT_ASSOCIATION_RADIUS_MINUTES,
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
  slotAssociationRadiusMinutes: number
}

export interface ScheduleSlotMatchConfig {
  associationRadiusMs: number
  lateGraceMs: number
}

function parseBoundedMinutes(value: string, fallback: number): number {
  const n = parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function legacyOverdueOffsetMinutes(): number | undefined {
  const raw = process.env.PUSH_OVERDUE_HOURS
  if (raw == null || raw.trim() === "") return undefined
  const hours = parseFloat(raw)
  if (!Number.isFinite(hours) || hours < 0) return undefined
  return Math.round(hours * 60)
}

function resolveScheduleMinutes(
  db: Database.Database,
  key: string,
  fallback: number,
  legacyFallback?: () => number | undefined,
): number {
  const resolved = resolveSetting(db, key)
  if (resolved.source === "env" || resolved.source === "db") {
    return parseBoundedMinutes(resolved.value, fallback)
  }
  const legacy = legacyFallback?.()
  if (legacy !== undefined) return legacy
  return fallback
}

/** Loads the three caregiver-tunable schedule timings from app_settings (with env/legacy fallbacks). */
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
      legacyOverdueOffsetMinutes,
    ),
    slotAssociationRadiusMinutes: resolveScheduleMinutes(
      db,
      SETTING_SCHEDULE_SLOT_ASSOCIATION_RADIUS_MINUTES,
      defaults.slotAssociationRadiusMinutes,
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

export function toScheduleSlotMatchConfig(timings: ScheduleTimings): ScheduleSlotMatchConfig {
  return {
    associationRadiusMs: timings.slotAssociationRadiusMinutes * 60_000,
    lateGraceMs: PUSH_DELIVERY_WINDOW_MINUTES * 60_000,
  }
}

export function loadScheduleSlotMatchConfig(db: Database.Database): ScheduleSlotMatchConfig {
  return toScheduleSlotMatchConfig(loadScheduleTimings(db))
}
