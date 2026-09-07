// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import type { ObservationTypeConfig } from "../domain-types"

export type { ObservationTypeConfig }

export function listObservationTypeConfigs(db: Database.Database): ObservationTypeConfig[] {
  return db.prepare(
    `SELECT id, observation_type, is_static, chart_type, typical_unit, sort_order, max_age_years,
            stale_after_hours, is_active
       FROM observation_type_config
      ORDER BY sort_order ASC, observation_type ASC`
  ).all() as ObservationTypeConfig[]
}

export function findObservationTypeConfig(
  db: Database.Database,
  observationType: string
): ObservationTypeConfig | undefined {
  return db
    .prepare(
      `SELECT id, observation_type, is_static, chart_type, typical_unit, sort_order, max_age_years,
              stale_after_hours, is_active
         FROM observation_type_config
        WHERE observation_type = ? COLLATE NOCASE`
    )
    .get(observationType.trim()) as ObservationTypeConfig | undefined
}

/**
 * Normalises a raw observation type label from an external source (e.g. spreadsheet import)
 * to the canonical form stored in the DB. Known aliases (e.g. "bp", "wt") are resolved;
 * unknown strings are title-cased.
 */
export function normalizeObservationLabel(raw: string): string {
  const t = raw.trim()
  if (!t) return t
  const lower = t.toLowerCase()
  const aliases: Record<string, string> = {
    weight: "Weight",
    wt: "Weight",
    temperature: "Temperature",
    temp: "Temperature",
    height: "Height",
    "blood pressure": "Blood Pressure",
    bp: "Blood Pressure",
    "heart rate": "Heart Rate",
    hr: "Heart Rate",
    spo2: "SpO2",
    "blood glucose": "Blood Glucose",
    bgl: "Blood Glucose",
    glucose: "Blood Glucose",
    respirations: "Respirations",
    rr: "Respirations",
    "head circumference": "Head Circumference",
    hc: "Head Circumference",
  }
  if (aliases[lower]) return aliases[lower]
  return t
    .split(/\s+/g)
    .map(w => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ")
}
