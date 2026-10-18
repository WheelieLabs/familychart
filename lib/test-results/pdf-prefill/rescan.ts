// SPDX-License-Identifier: AGPL-3.0-only

import type { TestMetricConfig } from "../../domain-types"
import { normalise } from "../test-metric-search"
import type { ExtractedRow } from "./extract"
import { matchMetric } from "./match"

/** Whether an attachment URL names a PDF; only PDFs can be read (no OCR), so only they can be rescanned. */
export function isPdfUrl(url: string): boolean {
  return url.split("?")[0]!.toLowerCase().endsWith(".pdf")
}

/** A chosen file or a fetched stored attachment: a PDF by its type, or by its file name when the type is blank. */
export function isPdfBlob(blob: Blob, name: string | null = null): boolean {
  return blob.type === "application/pdf" || (name ?? "").toLowerCase().endsWith(".pdf")
}

/** A value already on the result, as far as telling suggestions apart goes. */
export interface ExistingValue {
  metric_name: string
  isOther: boolean
}

/**
 * The suggestions not already represented on the result. A catalogue match is represented when a
 * value for that metric exists; an ambiguous one (HbA1c in two units, a bare Glucose) when any of its
 * candidates exists; an unmatched one when an "Other" value has the same name. Nothing is ever
 * overwritten: a second reading of a metric is still added deliberately through "+ Add value".
 */
export function withoutExistingMetrics(
  rows: ExtractedRow[],
  configs: TestMetricConfig[],
  existing: ExistingValue[],
): ExtractedRow[] {
  const catalogueNames = new Set(existing.filter(v => !v.isOther).map(v => v.metric_name.trim().toLowerCase()))
  const otherNames = new Set(existing.filter(v => v.isOther).map(v => normalise(v.metric_name)))
  return rows.filter(row => {
    const match = matchMetric(configs, row.name, row.unit)
    if (match.kind === "match") return !catalogueNames.has(match.config.metric_name.toLowerCase())
    if (match.kind === "ambiguous") return !match.candidates.some(c => catalogueNames.has(c.metric_name.toLowerCase()))
    return !otherNames.has(normalise(row.name))
  })
}
