// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import {
  SETTING_LOCALE_MEASUREMENT_SYSTEM,
  isValidMeasurementSystem,
  type MeasurementSystem,
} from "@/lib/settings/registry"
import { resolveSetting } from "@/lib/settings/resolver"

export type { MeasurementSystem }

/** Resolve tenant `locale.measurement_system` (default metric). */
export function resolveMeasurementSystem(db: Database.Database): MeasurementSystem {
  const { value } = resolveSetting(db, SETTING_LOCALE_MEASUREMENT_SYSTEM)
  return isValidMeasurementSystem(value) ? value : "metric"
}
