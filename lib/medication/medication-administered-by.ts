// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Who actually gave the dose — distinct from `created_by` (who logged it in FamilyChart).
 * Generic wording deliberately avoids naming school specifically: the same gap exists for
 * daycare, co-parenting, or respite care.
 */
export const MEDICATION_ADMINISTERED_BY = ["me", "another_caregiver", "away_from_home"] as const

export type MedicationAdministeredBy = (typeof MEDICATION_ADMINISTERED_BY)[number]

export const MEDICATION_ADMINISTERED_BY_LABELS: Record<MedicationAdministeredBy, string> = {
  me: "Me",
  another_caregiver: "Another caregiver",
  away_from_home: "Away from home",
}

export function isMedicationAdministeredBy(value: unknown): value is MedicationAdministeredBy {
  return (MEDICATION_ADMINISTERED_BY as readonly unknown[]).includes(value)
}
