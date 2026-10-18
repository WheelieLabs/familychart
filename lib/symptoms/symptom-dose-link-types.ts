// SPDX-License-Identifier: AGPL-3.0-only

// Types and constants only, so client components can import them without pulling in server code.

/** A medication dose as offered for, or shown against, a symptom. */
export interface LinkDose {
  id: number
  recorded_at: string
  medication_name: string
  dosage: number | null
  dosage_unit: string | null
}

/** A symptom as offered for, or shown against, a dose. */
export interface LinkSymptom {
  id: number
  label: string
  start_date: string
  end_date: string | null
  is_resolved: boolean
}

/** One link with both sides described, for History chips and the export. */
export interface PersonLink {
  symptom_event_id: number
  symptom_label: string
  medication_record_id: number
  medication_name: string
  recorded_at: string
}

/** Symptom-side candidate list on the Record Symptom form shows this many, most recent first. */
export const SYMPTOM_FORM_DOSE_CAP = 5
