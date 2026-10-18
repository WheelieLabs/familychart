// SPDX-License-Identifier: AGPL-3.0-only

import type { LimitQualifier, TestMetricConfig } from "@/lib/domain-types"

export interface ValueDraft {
  rowId: number
  /** Resolved catalogue name, or the carer's free text when `isOther`. */
  metric_name: string
  isOther: boolean
  value_type: "numeric" | "qualitative"
  limit_qualifier: LimitQualifier | ""
  numeric_value: string
  qualitative_value: string
  unit: string
  reference_range: string
  flagged: boolean
}

// Stable identity for each editable value row, so React keeps a row's inputs with that row when
// another row is removed (an array index would shift them).
let nextRowId = 0
export function newRowId(): number {
  return ++nextRowId
}

export function draftFromCatalogue(config: TestMetricConfig): ValueDraft {
  return {
    rowId: newRowId(),
    metric_name: config.metric_name,
    isOther: false,
    value_type: config.value_type,
    limit_qualifier: "",
    numeric_value: "",
    qualitative_value: "",
    unit: config.unit ?? "",
    reference_range: "",
    flagged: false,
  }
}

export function draftFromOther(name: string): ValueDraft {
  return {
    rowId: newRowId(),
    metric_name: name,
    isOther: true,
    value_type: "numeric",
    limit_qualifier: "",
    numeric_value: "",
    qualitative_value: "",
    unit: "",
    reference_range: "",
    flagged: false,
  }
}

/** A value prefilled from the report. Nothing is accepted until the carer taps Correct or Edit. */
export function draftFromRow(
  row: { name: string; value: number; qualifier: ValueDraft["limit_qualifier"] | null; unit: string | null; range: string | null },
  config: TestMetricConfig | null,
): ValueDraft {
  return {
    rowId: newRowId(),
    metric_name: config?.metric_name ?? row.name,
    isOther: config === null,
    value_type: "numeric",
    limit_qualifier: row.qualifier ?? "",
    numeric_value: String(row.value),
    qualitative_value: "",
    unit: row.unit ?? config?.unit ?? "",
    reference_range: row.range ?? "",
    flagged: false,
  }
}
