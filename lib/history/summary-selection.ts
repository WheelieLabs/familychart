// SPDX-License-Identifier: AGPL-3.0-only

/** URL helpers for the History > Summaries drill-down: the opened record lives in the `record` parameter. */

export type SummaryKind = "medication" | "observation" | "symptom" | "test_result"

/** The list view for a kind (no record opened). */
export function summaryListUrl(kind: SummaryKind): string {
  return `?tab=summaries&summary=${kind}`
}

/** A drill-down: the same list URL plus the opened record's identity. */
export function summaryRecordUrl(kind: SummaryKind, record: string): string {
  return `${summaryListUrl(kind)}&record=${encodeURIComponent(record)}`
}

/** The opened record from the URL, or null for the list. An empty value counts as no record. */
export function parseSummaryRecord(param: string | null): string | null {
  const record = param?.trim()
  return record ? record : null
}
