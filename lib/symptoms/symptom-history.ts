// SPDX-License-Identifier: AGPL-3.0-only

/** A symptom event as returned by `GET /api/symptom-events`. */
export interface SymptomEventSummary {
  id: number
  person_id: number
  label: string
  start_date: string
  end_date: string | null
  severity: number
  is_resolved: boolean
  resolved_at: string | null
  notes: string | null
}
