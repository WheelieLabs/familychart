// SPDX-License-Identifier: AGPL-3.0-only

import type { TestMetricConfig } from "../domain-types"

/** Lower-cases and drops everything but letters and digits, so "Pot.", "free t4" and "Alk. Phos" compare cleanly. */
export function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/** Lower rank = better match. `null` means no match. */
function rankMetric(config: TestMetricConfig, q: string): number | null {
  let best: number | null = null
  const consider = (term: string, exact: number, prefix: number, contains: number) => {
    const t = normalise(term)
    if (!t) return
    const rank = t === q ? exact : t.startsWith(q) ? prefix : t.includes(q) ? contains : null
    if (rank !== null && (best === null || rank < best)) best = rank
  }
  consider(config.metric_name, 0, 2, 4)
  // "HbA1c (%)" and "HbA1c (mmol/mol)" both answer an exact "HbA1c"; likewise "Glucose".
  consider(config.metric_name.replace(/\([^)]*\)/g, ""), 0, 2, 4)
  for (const alias of config.aliases) consider(alias, 1, 3, 5)
  return best
}

/**
 * Type-and-search over the active catalogue (names and aliases). Results are ordered by match
 * quality (exact, prefix, substring; name before alias), then catalogue order.
 */
export function searchTestMetrics(configs: TestMetricConfig[], query: string, limit = 8): TestMetricConfig[] {
  const q = normalise(query)
  if (!q) return []
  return configs
    .filter(c => c.is_active === 1)
    .map(c => ({ c, rank: rankMetric(c, q) }))
    .filter((r): r is { c: TestMetricConfig; rank: number } => r.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.c.sort_order - b.c.sort_order)
    .slice(0, limit)
    .map(r => r.c)
}

export interface RecentMetricSuggestion {
  label: string
  /** The catalogue row, or null for a free-text ("Other") name previously used on this person. */
  config: TestMetricConfig | null
}

/** The metrics recorded most recently for a person (empty-field suggestions), newest first, de-duplicated. */
export function recentMetricSuggestions(
  configs: TestMetricConfig[],
  events: { date: string; values: { metric_name: string }[] }[],
  limit = 8,
): RecentMetricSuggestion[] {
  const byName = new Map(configs.filter(c => c.is_active === 1).map(c => [c.metric_name.toLowerCase(), c]))
  const seen = new Set<string>()
  const out: RecentMetricSuggestion[] = []
  const newestFirst = [...events].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  for (const event of newestFirst) {
    for (const v of event.values) {
      const key = v.metric_name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const config = byName.get(key) ?? null
      out.push({ label: config?.metric_name ?? v.metric_name, config })
      if (out.length >= limit) return out
    }
  }
  return out
}
