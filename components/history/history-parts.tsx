// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useId, useState, type ReactNode } from "react"
import Badge from "@/components/ui/Badge"
import Button from "@/components/ui/Button"
import ListCard from "@/components/ui/ListCard"
import { ChipGroup } from "@/components/ui/Chip"
import { Input, Select } from "@/components/ui/controls"
import DateEcho from "@/components/ui/DateEcho"
import FormField, { FieldRow } from "@/components/ui/FormField"
import Panel from "@/components/ui/Panel"
import TimeZoneHint from "@/components/ui/TimeZoneHint"
import LinkedItemsEditor from "@/components/LinkedItemsEditor"
import { MEDICATION_DOSAGE_UNITS } from "@/lib/medication/medication-units"
import {
  MEDICATION_ADMINISTERED_BY,
  MEDICATION_ADMINISTERED_BY_LABELS,
  type MedicationAdministeredBy,
} from "@/lib/medication/medication-administered-by"
import type { DoseMissedSummary } from "@/lib/medication/dose-missed-history"
import type { FeedChipKind, FeedFlag } from "@/lib/history/feed"
import type { LinkDelta } from "@/lib/symptoms/link-editing"

const DOSAGE_UNITS = [...MEDICATION_DOSAGE_UNITS]

export interface MedDraft {
  date: string
  time: string
  dosage: string
  dosage_unit: string
  comments: string
  administered_by: MedicationAdministeredBy
}

export interface ObsDraft {
  date: string
  time: string
  value: string
  unit: string
  comments: string
  observation_type: string
}

export interface BpDraft {
  date: string
  time: string
  systolic: string
  diastolic: string
  comments: string
  sysId: number
  diaId: number | null
}

/** The four filterable record kinds: label and the dot colour shared by the filter, the legend and the calendar. */
export const FEED_KIND_META: Record<FeedChipKind, { label: string; dotColor: string }> = {
  medication: { label: "Medication", dotColor: "#34d399" },
  observation: { label: "Observation", dotColor: "#7dd3fc" },
  symptom: { label: "Symptom", dotColor: "#fbbf24" },
  test_result: { label: "Test Result", dotColor: "#a78bfa" },
}
export const FEED_KINDS = Object.keys(FEED_KIND_META) as FeedChipKind[]

/** Pick one kind of record to show (or all). */
export function FeedKindChips({
  legend = "Show",
  value,
  onChange,
}: {
  legend?: string
  value: FeedChipKind | "all"
  onChange: (v: FeedChipKind | "all") => void
}) {
  return (
    <ChipGroup
      legend={legend}
      value={value}
      onChange={onChange}
      options={[
        { value: "all" as const, label: "All" },
        ...FEED_KINDS.map(k => ({ value: k, label: FEED_KIND_META[k].label })),
      ]}
    />
  )
}

export function FlagBadge({ flag }: { flag: FeedFlag | null }) {
  if (!flag) return null
  const tone = flag.level === "red" ? "error" : flag.level === "amber" ? "warning" : flag.level === "info" ? "info" : "neutral"
  return <Badge tone={tone}>{flag.label}</Badge>
}

/** Read-only badge distinguishing an externally-administered dose from a self-administered one. */
export function AdministeredByBadge({ administeredBy }: { administeredBy: MedicationAdministeredBy | null | undefined }) {
  if (administeredBy == null || administeredBy === "me") return null
  return <Badge tone="neutral">{MEDICATION_ADMINISTERED_BY_LABELS[administeredBy]}</Badge>
}

/** The from and to dates of a list, with the button that applies them. */
export function RangeFields({
  from,
  to,
  onFrom,
  onTo,
  onApply,
  extra,
}: {
  from: string
  to: string
  onFrom: (v: string) => void
  onTo: (v: string) => void
  /** Leave out when the list reloads as the dates change; the button is then not shown. */
  onApply?: () => void
  /** Quick ranges (7, 30 or 90 days) shown with the apply button. */
  extra?: ReactNode
}) {
  return (
    <Panel>
      <div className="fc-form-pair">
        <FormField label="From">
          <Input type="date" value={from} onChange={e => onFrom(e.target.value)} />
        </FormField>
        <FormField label="To">
          <Input type="date" value={to} onChange={e => onTo(e.target.value)} />
        </FormField>
      </div>
      {(onApply || extra) && (
        <div className="fc-form-actions">
          {onApply && <Button onClick={onApply}>Show records</Button>}
          {extra}
        </div>
      )}
    </Panel>
  )
}

/** The Date and Time rows of an edit form, with the one spelled-out line and the timezone hint. */
function DateTimeFields({
  date,
  time,
  onDate,
  onTime,
}: {
  date: string
  time: string
  onDate: (v: string) => void
  onTime: (v: string) => void
}) {
  return (
    <div className="fc-field-pair">
      <FormField label="Date" layout="inline">
        <Input type="date" value={date} onChange={e => onDate(e.target.value)} />
      </FormField>
      <FormField label="Time" layout="inline">
        <Input type="time" value={time} onChange={e => onTime(e.target.value)} />
      </FormField>
      <DateEcho date={date} time={time} />
      <TimeZoneHint />
    </div>
  )
}

/** A light edit form among the cards, with Cancel and a Save that shows "Saving…" and ignores repeat taps. */
export function EditPanel({
  children,
  onCancel,
  onSave,
}: {
  children: ReactNode
  onCancel: () => void
  onSave: () => void | Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  return (
    <Panel>
      {children}
      <div className="fc-form-actions">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button
          pending={saving}
          onClick={async () => {
            setSaving(true)
            try {
              await onSave()
            } finally {
              setSaving(false)
            }
          }}
        >
          Save
        </Button>
      </div>
    </Panel>
  )
}

export function MedEditForm({
  draft,
  onChange,
  onCancel,
  onSave,
  personId,
  recordId,
  recordedAtIso,
  onLinkChange,
}: {
  draft: MedDraft
  onChange: (patch: Partial<MedDraft>) => void
  onCancel: () => void
  onSave: () => void | Promise<void>
  personId: string
  recordId: number
  recordedAtIso: string
  onLinkChange: (delta: LinkDelta) => void
}) {
  return (
    <EditPanel onCancel={onCancel} onSave={onSave}>
      <DateTimeFields date={draft.date} time={draft.time} onDate={date => onChange({ date })} onTime={time => onChange({ time })} />
      <FormField label="Dosage" optional>
        <FieldRow>
          <Input type="number" value={draft.dosage} min="0" step="0.1" onChange={e => onChange({ dosage: e.target.value })} />
          <Select aria-label="Unit" value={draft.dosage_unit} onChange={e => onChange({ dosage_unit: e.target.value })}>
            {DOSAGE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </Select>
        </FieldRow>
      </FormField>
      <FormField label="Comments" optional>
        <Input type="text" value={draft.comments} onChange={e => onChange({ comments: e.target.value })} />
      </FormField>
      <ChipGroup
        legend="Administered by"
        value={draft.administered_by}
        onChange={administered_by => onChange({ administered_by })}
        options={MEDICATION_ADMINISTERED_BY.map(v => ({ value: v, label: MEDICATION_ADMINISTERED_BY_LABELS[v] }))}
      />
      <LinkedItemsEditor kind="dose" tone="light" personId={personId} recordId={recordId}
        recordedAtIso={recordedAtIso} onChange={onLinkChange} />
    </EditPanel>
  )
}

export function ObsEditForm({
  draft,
  units,
  onChange,
  onCancel,
  onSave,
}: {
  draft: ObsDraft
  /** The unit choices for the type; leave out to type the unit. */
  units?: readonly string[]
  onChange: (patch: Partial<ObsDraft>) => void
  onCancel: () => void
  onSave: () => void | Promise<void>
}) {
  return (
    <EditPanel onCancel={onCancel} onSave={onSave}>
      <DateTimeFields date={draft.date} time={draft.time} onDate={date => onChange({ date })} onTime={time => onChange({ time })} />
      <FormField label="Value">
        <FieldRow>
          <Input type="number" value={draft.value} step="any" onChange={e => onChange({ value: e.target.value })} />
          {units ? (
            <Select aria-label="Unit" value={draft.unit} onChange={e => onChange({ unit: e.target.value })}>
              {units.map(u => <option key={u} value={u}>{u}</option>)}
            </Select>
          ) : (
            <Input type="text" aria-label="Unit" value={draft.unit} onChange={e => onChange({ unit: e.target.value })} />
          )}
        </FieldRow>
      </FormField>
      <FormField label="Comments" optional>
        <Input type="text" value={draft.comments} onChange={e => onChange({ comments: e.target.value })} />
      </FormField>
    </EditPanel>
  )
}

export function BpEditForm({
  draft,
  onChange,
  onCancel,
  onSave,
}: {
  draft: BpDraft
  onChange: (patch: Partial<BpDraft>) => void
  onCancel: () => void
  onSave: () => void | Promise<void>
}) {
  const hintId = useId()
  return (
    <EditPanel onCancel={onCancel} onSave={onSave}>
      <DateTimeFields date={draft.date} time={draft.time} onDate={date => onChange({ date })} onTime={time => onChange({ time })} />
      <div className="fc-form-pair" aria-describedby={hintId}>
        <FormField label="Systolic">
          <Input type="number" value={draft.systolic} step="1" min="0" onChange={e => onChange({ systolic: e.target.value })} />
        </FormField>
        <FormField label="Diastolic">
          <Input type="number" value={draft.diastolic} step="1" min="0" onChange={e => onChange({ diastolic: e.target.value })} />
        </FormField>
      </div>
      <p id={hintId} className="fc-field__hint">Blood pressure in mmHg.</p>
      <FormField label="Comments" optional>
        <Input type="text" value={draft.comments} onChange={e => onChange({ comments: e.target.value })} />
      </FormField>
    </EditPanel>
  )
}

/** A table of records among dark cards, with the edit form replacing a row while it is edited. */
export function RecordTable({
  id,
  caption,
  columns,
  rows,
  hasActions,
}: {
  id?: string
  caption: string
  columns: readonly string[]
  rows: readonly {
    key: string
    cells: readonly ReactNode[]
    /** Cells that should not wrap (a date, a value). */
    nowrap?: readonly boolean[]
    actions?: ReactNode
    /** Replaces the row while it is being edited. */
    editing?: ReactNode
    note?: number
  }[]
  hasActions: boolean
}) {
  return (
    <div className="fc-table-wrap">
      <table id={id} className="fc-table">
        <caption className="fc-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map(c => <th key={c} scope="col">{c}</th>)}
            {hasActions && <th scope="col"><span className="fc-visually-hidden">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(row =>
            row.editing ? (
              <tr key={row.key}>
                <td colSpan={columns.length + (hasActions ? 1 : 0)}>{row.editing}</td>
              </tr>
            ) : (
              <tr key={row.key}>
                {row.cells.map((cell, i) => (
                  <td
                    // eslint-disable-next-line react-x/no-array-index-key -- cells are positional columns
                    key={i}
                    className={[row.nowrap?.[i] ? "fc-table__nowrap" : "", row.note === i ? "fc-table__note" : ""].filter(Boolean).join(" ") || undefined}
                  >
                    {cell}
                  </td>
                ))}
                {hasActions && <td className="fc-table__actions">{row.actions}</td>}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  )
}

/** A Missed slot row: red left edge, "Missed" badge and what is known about the dose. Shared by the Live Feed, Calendar and the medication Summaries list. */
export function MissedDoseCard({
  missed,
  rowId,
  highlighted,
  timeText,
}: {
  missed: DoseMissedSummary
  rowId?: string
  highlighted?: boolean
  /** The slot time, formatted by the screen's own time formatter. */
  timeText: string
}) {
  return (
    <ListCard
      rowId={rowId}
      highlighted={highlighted}
      icon="💊"
      title={missed.medication_name}
      missed
      meta={[
        `${timeText} dose`,
        missed.cause === "not_given" ? "Confirmed not given. No dose was recorded." : "No dose was recorded.",
      ]}
      extras={<Badge tone="error">Missed</Badge>}
    />
  )
}
