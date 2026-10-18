// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { ChipGroup } from "@/components/ui/Chip"
import { Checkbox, Input, Select } from "@/components/ui/controls"
import FormField, { FieldRow } from "@/components/ui/FormField"
import type { LimitQualifier } from "@/lib/domain-types"
import type { ValueDraft } from "./value-draft"

interface ValueFieldsProps {
  draft: ValueDraft
  onChange: (patch: Partial<ValueDraft>) => void
}

const QUALIFIERS: LimitQualifier[] = ["<", "<=", ">", ">="]

/**
 * The editable fields of one value: name (for a custom test), number or words, limit qualifier, value
 * and unit, the reference range transcribed from the report (never derived), and "differs from
 * expected". Shared by the value row and by a suggestion being edited in place.
 */
export default function ValueFields({ draft, onChange }: ValueFieldsProps) {
  return (
    <div className="fc-form">
      {draft.isOther && (
        <>
          <FormField label="Test name" hint="This test is not in the catalogue.">
            <Input type="text" value={draft.metric_name} onChange={e => onChange({ metric_name: e.target.value })} />
          </FormField>
          <ChipGroup
            legend="Type of result"
            options={[
              { value: "numeric", label: "Number" },
              { value: "qualitative", label: "Result (words)" },
            ]}
            value={draft.value_type}
            onChange={value_type =>
              onChange(value_type === "numeric" ? { value_type } : { value_type, limit_qualifier: "" })}
          />
        </>
      )}

      {draft.value_type === "numeric" ? (
        <>
          <FormField label="Value">
            <FieldRow>
              <Select value={draft.limit_qualifier} aria-label="Limit qualifier"
                onChange={e => onChange({ limit_qualifier: e.target.value as LimitQualifier | "" })}>
                <option value="">=</option>
                {QUALIFIERS.map(q => <option key={q} value={q}>{q}</option>)}
              </Select>
              <Input type="number" inputMode="decimal" step="any" value={draft.numeric_value}
                onChange={e => onChange({ numeric_value: e.target.value })} />
            </FieldRow>
          </FormField>
          <FormField label="Unit" optional>
            <Input type="text" value={draft.unit} onChange={e => onChange({ unit: e.target.value })} />
          </FormField>
        </>
      ) : (
        <FormField label="Result">
          <Input type="text" value={draft.qualitative_value} placeholder="e.g. Detected or Not detected"
            onChange={e => onChange({ qualitative_value: e.target.value })} />
        </FormField>
      )}

      <FormField label="Reference range" optional hint="Copy it from the report.">
        <Input type="text" value={draft.reference_range} onChange={e => onChange({ reference_range: e.target.value })} />
      </FormField>
      <Checkbox label="Differs from expected" checked={draft.flagged} onChange={e => onChange({ flagged: e.target.checked })} />
    </div>
  )
}
