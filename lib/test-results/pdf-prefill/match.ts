// SPDX-License-Identifier: AGPL-3.0-only

import type { TestMetricConfig } from "../../domain-types"
import { normalise } from "../test-metric-search"

export type MetricMatch =
  | { kind: "match"; config: TestMetricConfig }
  /** More than one catalogue entry fits; the carer chooses in the Edit step, the app never guesses. */
  | { kind: "ambiguous"; candidates: TestMetricConfig[] }
  | { kind: "none" }

/** Name as a report prints it, with a leading asterisk, trailing colon and parentheticals removed. */
function reportNameKey(name: string): string {
  return normalise(name.replace(/\([^)]*\)/g, ""))
}

function unitKey(unit: string | null): string {
  return unit ? unit.toLowerCase().replace(/µ/g, "u").replace(/\s+/g, "") : ""
}

/**
 * Matches a name printed on a report to the catalogue: exact name or alias only (never a
 * substring). Entries sharing a name once their unit qualifier is dropped (HbA1c in two units,
 * Glucose fasting/random) are told apart by the unit the report prints; if that does not settle
 * it, the match is ambiguous and the carer resolves it.
 */
export function matchMetric(configs: TestMetricConfig[], reportName: string, reportUnit: string | null): MetricMatch {
  const key = reportNameKey(reportName)
  if (!key) return { kind: "none" }

  // A percentage row ("Neutrophils %", unit %) is never a count metric: the unit mismatch blocks the match.
  const percentageRow = unitKey(reportUnit) === "%" || /%\s*$/.test(reportName.trim())

  const named = (c: TestMetricConfig, k: string) =>
    normalise(c.metric_name) === k || c.aliases.some(a => normalise(a) === k)
  const active = configs.filter(c => c.is_active === 1 && (!percentageRow || unitKey(c.unit) === "%"))
  // The name exactly as printed wins, so "Calcium (ionised)" is not read as total "Calcium" once the
  // parenthetical is dropped; only then is the parenthetical-free name tried.
  const fullKey = normalise(reportName)
  const exact = active.filter(c => named(c, fullKey))
  const candidates = exact.length > 0
    ? exact
    : active.filter(c => reportNameKey(c.metric_name) === key || named(c, key))
  if (candidates.length === 0) return { kind: "none" }
  if (candidates.length === 1) return { kind: "match", config: candidates[0]! }

  const reportUnitKey = unitKey(reportUnit)
  if (reportUnitKey) {
    const byUnit = candidates.filter(c => unitKey(c.unit) === reportUnitKey)
    if (byUnit.length === 1) return { kind: "match", config: byUnit[0]! }
  }
  return { kind: "ambiguous", candidates }
}
