// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Row-shaped types shared by API responses and UI.
 * Import from here in client components; `lib/db.ts` re-exports for server code.
 */

export interface MedicationGroup {
  id: number
  name: string
  notes: string | null
  is_active: number
}

/** `name` is the display name (home list, headers); `full_name` for reports and formal use. */
export interface Person {
  id: number
  name: string
  full_name: string | null
  photo_url: string | null
  color: string
  sort_order: number
  is_active: number
  account_uid: string | null
  date_of_birth: string | null
}

export interface Medication {
  id: number
  name: string
  default_dosage: number | null
  dosage_unit: string
  notes: string | null
  is_active: number
  min_age_years: number | null
  max_age_years: number | null
}

export interface MedicationGroupMember {
  id: number
  medication_id: number
  group_id: number
}

export interface FrequencyRule {
  id: number
  medication_id: number | null
  min_hours_between: number
  max_hours_between: number | null
  max_quantity_per_24h: number | null
  /** Intended to match medication dosage_unit; enforcement uses the medication’s unit. */
  max_quantity_unit: string | null
  /** When 1, max_quantity_per_24h is compared to dose count; when 0, to summed amounts. */
  max_per_24h_count_doses: number
  min_age_years: number | null
  max_age_years: number | null
  min_weight_kg: number | null
  max_weight_kg: number | null
  /** When set, overrides the medication catalog default dose for this rule band. */
  dosage: number | null
}

export interface MedicationRecord {
  id: number
  person_id: number
  medication_id: number
  medication_name?: string
  recorded_at: string
  dosage: number | null
  dosage_unit: string | null
  comments: string | null
}

export interface Observation {
  id: number
  person_id: number
  observation_type: string
  value: number
  unit: string
  recorded_at: string
  comments: string | null
  session_id: string | null
  value_label: string | null
}

export interface ObservationTypeConfig {
  id: number
  observation_type: string
  is_static: number
  chart_type: string
  typical_unit: string | null
  sort_order: number
  /** When set and person has DOB, type is hidden for ages above this ceiling; null = all ages */
  max_age_years: number | null
  /** When set, History highlights when the latest reading is older than this many hours; null = off */
  stale_after_hours: number | null
  /** 1 = available for new recordings; 0 = catalogue only / hidden from pickers */
  is_active: number
}

export interface PushEndpoint {
  id: number
  user_uid: string
  endpoint: string
  p256dh: string
  web_push_auth: string
  user_agent: string | null
  created_at: string
  last_used_at: string | null
}

/**
 * One row per canonical account, local or federated (Entra). `password_hash`/`totp_secret*`
 * are only ever set for `auth_method === "local"`; a pending invite (`status === "invited"`)
 * also has a null `password_hash` until accepted, so `auth_method` — not null-checks — is the
 * source of truth for whether an account is local or Entra-backed.
 */
export interface Account {
  id: number
  email: string
  password_hash: string | null
  role: string
  can_report: number
  is_active: number
  totp_secret: string | null
  totp_secret_pending: string | null
  session_version: number
  must_reset_password: number
  auth_method: "local" | "entra"
  external_id: string | null
  status: "invited" | "active"
  invite_token_hash: string | null
  invite_expires_at: string | null
  invite_revoked_at: string | null
  created_at: string
}

export interface SystemConfig {
  key: string
  value: string | null
  updated_at: string
}

export interface PersonNotificationPrefs {
  id: number
  person_id: number
  user_uid: string
  notify_prn: number
  notify_prescribed: number
  notify_overdue: number
  notify_observations: number
  notify_hydration: number
}

export interface PersonMedication {
  id: number
  person_id: number
  medication_id: number
  is_active: number
  schedule_times: string | null
  schedule_frequency: string | null
  schedule_start_date: string | null
  schedule_end_date: string | null
  schedule_slots: string | null
  schedule_tz: string | null
}

export interface ObservationGoal {
  id: number
  person_id: number
  observation_type: string
  goal_type: string
  target_value: number
  target_max: number | null
  unit: string
  is_active: number
  created_at: string
  target_date: string | null
}

export interface Favourite {
  id: number
  user_uid: string
  person_id: number
  action_kind: string
  medication_id: number | null
  observation_type: string | null
  default_value: string | null
  label: string | null
  sort_order: number
  created_at: string
}

export interface FavouriteResolved extends Favourite {
  person_name: string | null
  person_color: string | null
  medication_name: string | null
  resolved: boolean
}
