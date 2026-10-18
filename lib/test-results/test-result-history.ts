// SPDX-License-Identifier: AGPL-3.0-only

import type { LimitQualifier } from "../domain-types"

export interface TestResultValueSummary {
  metric_name: string
  value_type: "numeric" | "qualitative"
  numeric_value: number | null
  qualitative_value: string | null
  unit: string | null
  reference_range: string | null
  flag: string | null
  limit_qualifier: LimitQualifier | null
}

/** A test event with its curated structured values, as returned by `GET /api/test-events`. */
export interface TestResultSummary {
  id: number
  person_id: number
  test_type: string
  name: string
  date: string
  ordered_by: string | null
  notes: string | null
  attachment_url: string | null
  values: TestResultValueSummary[]
}
