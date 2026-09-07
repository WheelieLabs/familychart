// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared medication catalogue dosage units.
 * Canonical strings used by management, record, history, and import UIs.
 */
export const MEDICATION_DOSAGE_UNITS = [
  "Tabs",
  "mL",
  "mg",
  "mcg",
  "g",
  "drops",
  "puffs",
  "patch",
  "applications",
] as const

export type MedicationDosageUnit = (typeof MEDICATION_DOSAGE_UNITS)[number]

/** Spreadsheet import aliases → canonical catalogue unit. */
export const MEDICATION_DOSAGE_UNIT_ALIASES: Record<string, MedicationDosageUnit> = {
  ml: "mL",
  mls: "mL",
  mg: "mg",
  mcg: "mcg",
  g: "g",
  tab: "Tabs",
  tabs: "Tabs",
  tablet: "Tabs",
  tablets: "Tabs",
  drop: "drops",
  drops: "drops",
  puff: "puffs",
  puffs: "puffs",
  patch: "patch",
  application: "applications",
  applications: "applications",
}

export function normaliseMedicationDosageUnitAlias(raw: string): string {
  const hit = MEDICATION_DOSAGE_UNIT_ALIASES[raw.trim().toLowerCase()]
  return hit ?? raw
}
