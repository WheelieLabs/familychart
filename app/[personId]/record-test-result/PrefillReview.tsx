// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useMemo, useState } from "react"
import Button from "@/components/ui/Button"
import { Select } from "@/components/ui/controls"
import FormField from "@/components/ui/FormField"
import { disabledWhen } from "@/lib/ui/disabled-props"
import type { TestMetricConfig } from "@/lib/domain-types"
import type { ExtractedRow } from "@/lib/test-results/pdf-prefill/extract"
import { matchMetric, type MetricMatch } from "@/lib/test-results/pdf-prefill/match"
import type { ReadPdf } from "@/lib/test-results/pdf-prefill/read-pdf"
import SourceStrip from "./SourceStrip"
import ValueFields from "./ValueFields"
import { draftFromRow, type ValueDraft } from "./value-draft"

interface PrefillReviewProps {
  pdf: ReadPdf
  rows: ExtractedRow[]
  configs: TestMetricConfig[]
  /** Adds a confirmed value to the form (as a read-only summary; Edit on it reopens it). */
  onAdd: (draft: ValueDraft) => void
}

interface ReviewItem {
  row: ExtractedRow
  match: MetricMatch
}

function rangeText(row: ExtractedRow): string {
  return row.range ? `range (${row.range})` : "no range found"
}

function valueText(row: ExtractedRow): string {
  return `${row.qualifier ?? ""}${row.qualifier ? " " : ""}${row.value}${row.unit ? ` ${row.unit}` : ""}`
}

function ReviewCard({ item, pdf, onAdd, onSkip }: {
  item: ReviewItem
  pdf: ReadPdf
  onAdd: (draft: ValueDraft) => void
  onSkip: () => void
}) {
  const { row, match } = item
  const [chosen, setChosen] = useState("")
  // Editing keeps the card where it is, with the line from the report beside it, until Done.
  const [draft, setDraft] = useState<ValueDraft | null>(null)
  const config = match.kind === "match" ? match.config : null
  const ambiguous = match.kind === "ambiguous"
  const chosenConfig = ambiguous ? match.candidates.find(c => c.metric_name === chosen) ?? null : null
  const title = draft?.metric_name || config?.metric_name || row.name

  return (
    <li className="fc-subform">
      <div>
        <p className="fc-value-row__title">
          {title}
          {config && config.metric_name.toLowerCase() !== row.name.toLowerCase() && (
            <span className="fc-value-row__flag"> (report says “{row.name}”)</span>
          )}
        </p>
        {!draft && (
          <p className="fc-value-row__summary">{valueText(row)} · <span className="fc-field__hint">{rangeText(row)}</span></p>
        )}
      </div>

      <SourceStrip pdf={pdf} row={row} />

      {draft ? (
        <>
          <ValueFields draft={draft} onChange={patch => setDraft(d => (d ? { ...d, ...patch } : d))} />
          <div className="fc-form-actions">
            <Button aria-label={`Done editing ${title}`} onClick={() => onAdd(draft)}>Done</Button>
            <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </>
      ) : (
        <>
          {ambiguous && (
            <FormField label={`Which test is “${row.name}”?`}>
              <Select value={chosen} onChange={e => setChosen(e.target.value)}>
                <option value="">Choose…</option>
                {match.candidates.map(c => <option key={c.metric_name} value={c.metric_name}>{c.metric_name}</option>)}
              </Select>
            </FormField>
          )}

          <div className="fc-form-actions">
            {!ambiguous && (
              <Button onClick={() => onAdd(draftFromRow(row, config))}>Correct</Button>
            )}
            <Button
              variant="secondary"
              onClick={() => setDraft(draftFromRow(row, ambiguous ? chosenConfig : config))}
              {...disabledWhen(ambiguous && !chosenConfig && "Choose which test it is first.")}
            >
              Edit
            </Button>
            <Button variant="quiet" onClick={onSkip}>Skip</Button>
          </div>
        </>
      )}
    </li>
  )
}

/**
 * Review of values found in the report. Catalogue matches first, then a collapsed list of other
 * results. Nothing is pre-accepted: Correct adds the value as read, Edit opens its fields in place
 * (beside the line from the report) for a misread digit, unit or ambiguity and Done adds it, Skip drops it.
 */
export default function PrefillReview({ pdf, rows, configs, onAdd }: PrefillReviewProps) {
  const [handled, setHandled] = useState<Set<string>>(() => new Set())
  const items = useMemo<ReviewItem[]>(
    () => rows.map(row => ({ row, match: matchMetric(configs, row.name, row.unit) })),
    [rows, configs],
  )
  const open = items.filter(i => !handled.has(i.row.id))
  const catalogue = open.filter(i => i.match.kind !== "none")
  const other = open.filter(i => i.match.kind === "none")

  function resolve(item: ReviewItem, draft?: ValueDraft) {
    setHandled(h => new Set(h).add(item.row.id))
    if (draft) onAdd(draft)
  }

  const renderCard = (item: ReviewItem) => (
    <ReviewCard key={item.row.id} item={item} pdf={pdf}
      onAdd={draft => resolve(item, draft)} onSkip={() => resolve(item)} />
  )

  return (
    <section aria-label="Values found in this report" className="fc-form">
      <h2 className="fc-section-title">Found {rows.length} value{rows.length === 1 ? "" : "s"} in this report</h2>
      <p className="fc-field__hint">
        Check each against the line from the report. Nothing is added until you tap Correct or Edit.
      </p>
      {catalogue.length > 0 && <ul className="fc-card-list">{catalogue.map(renderCard)}</ul>}
      {other.length > 0 && (
        <details>
          <summary className="fc-summary">
            Other results in this report ({other.length})
          </summary>
          <ul className="fc-card-list">{other.map(renderCard)}</ul>
        </details>
      )}
      {open.length === 0 && <p className="fc-field__hint">All reviewed.</p>}
    </section>
  )
}
