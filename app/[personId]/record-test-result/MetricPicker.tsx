// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useId, useMemo, useState } from "react"
import Button from "@/components/ui/Button"
import { Input } from "@/components/ui/controls"
import FormField from "@/components/ui/FormField"
import SuggestionList from "@/components/ui/SuggestionList"
import type { TestMetricConfig } from "@/lib/domain-types"
import { recentMetricSuggestions, searchTestMetrics } from "@/lib/test-results/test-metric-search"

interface MetricPickerProps {
  configs: TestMetricConfig[]
  /** Past events for this person, used for the empty-field "recent" suggestions. */
  history: { date: string; values: { metric_name: string }[] }[]
  onPickCatalogue: (config: TestMetricConfig) => void
  onPickOther: (name: string) => void
  onCancel: () => void
}

const detail = (config: TestMetricConfig) =>
  `${config.unit ? ` · ${config.unit}` : ""}${config.panel ? ` · ${config.panel}` : ""}`

/**
 * Type-and-search metric picker (like Record Medication). Empty field: the metrics recorded most
 * recently for this person. Typing: names and aliases. "Other (type a name)" is always last.
 */
export default function MetricPicker({ configs, history, onPickCatalogue, onPickOther, onCancel }: MetricPickerProps) {
  const [query, setQuery] = useState("")
  const listId = useId()
  const trimmed = query.trim()

  const recents = useMemo(() => recentMetricSuggestions(configs, history, 8), [configs, history])
  const results = useMemo(() => searchTestMetrics(configs, trimmed, 8), [configs, trimmed])

  const items = [
    ...(trimmed === ""
      ? recents.map(r => ({
          key: r.label,
          onSelect: () => (r.config ? onPickCatalogue(r.config) : onPickOther(r.label)),
          label: (
            <>
              <span className="fc-suggest__name">{r.label}</span>
              <span className="fc-suggest__detail">{r.config ? detail(r.config) : " · other"}</span>
            </>
          ),
        }))
      : results.map(c => ({
          key: c.metric_name,
          onSelect: () => onPickCatalogue(c),
          label: (
            <>
              <span className="fc-suggest__name">{c.metric_name}</span>
              <span className="fc-suggest__detail">{detail(c)}</span>
            </>
          ),
        }))),
    {
      key: "other",
      onSelect: () => onPickOther(trimmed),
      label: <>Other (type a name){trimmed ? `: “${trimmed}”` : ""}</>,
    },
  ]

  return (
    <div className="fc-subform">
      <FormField label="Search for a test" hint="Type a name or abbreviation, e.g. Hb, TSH or BUN.">
        <Input type="search" autoFocus value={query} onChange={e => setQuery(e.target.value)}
          aria-controls={listId}
          onKeyDown={e => { if (e.key === "Escape") onCancel() }} />
      </FormField>
      {trimmed === "" && recents.length > 0 && <p className="fc-field__hint">Recent for this person</p>}
      <SuggestionList id={listId} items={items} />
      <div>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}
