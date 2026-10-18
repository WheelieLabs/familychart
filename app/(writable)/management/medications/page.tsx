// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { Suspense, useState, useEffect, useRef, type ReactNode } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import Modal from "@/components/Modal"
import ConfirmModal, {
  medicationRemoveResultCopy,
  removeMedicationConfirmCopy,
  type ConfirmVariant,
} from "@/components/ConfirmModal"
import Badge from "@/components/ui/Badge"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import { Checkbox, Input, Select, Toggle } from "@/components/ui/controls"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import EntityRowActions from "@/components/ui/EntityRowActions"
import { FcTabBar, type FcTabItem } from "@/components/ui/FcTabBar"
import FormField, { FieldGroup, FieldRow } from "@/components/ui/FormField"
import IconButton from "@/components/ui/IconButton"
import ListCard, { CardList } from "@/components/ui/ListCard"
import PageContainer from "@/components/ui/PageContainer"
import ManagementStickyAdd from "@/components/ManagementStickyAdd"
import { formatCount, formatUnitCount } from "@/lib/format-count"
import { MEDICATION_DOSAGE_UNITS } from "@/lib/medication/medication-units"
import { managementTrail } from "@/lib/ui/breadcrumbs"
import { focusFirstInvalid } from "@/lib/ui/form-errors"
// ── Age input helpers ─────────────────────────────────────────────────────────

type AgeInputUnit = "years" | "months"

function ageInputToStoredYears(value: number | null, unit: AgeInputUnit): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return unit === "months" ? value / 12 : value
}

function convertAgeDisplayPair(
  min: number | null,
  max: number | null,
  from: AgeInputUnit,
  to: AgeInputUnit
): { min: number | null; max: number | null } {
  if (from === to) return { min, max }
  const scale = from === "years" && to === "months" ? 12 : 1 / 12
  const c = (x: number | null) => (x == null ? null : x * scale)
  return { min: c(min), max: c(max) }
}

function formatStoredAgeYears(years: number): string {
  const mo = years * 12
  const moRound = Math.round(mo)
  if (moRound >= 1 && moRound <= 1440 && Math.abs(mo - moRound) < 0.06) {
    return `${moRound} mo`
  }
  const y = Math.round(years * 1000) / 1000
  if (Math.abs(y - Math.round(y)) < 1e-6) return formatCount(Math.round(y), "yr")
  return `${y} yrs`
}

function ageRangeLabel(min: number | null, max: number | null): string {
  if (min === null && max === null) return ""
  if (min !== null && max !== null) return `${formatStoredAgeYears(min)}–${formatStoredAgeYears(max)}`
  if (min !== null) return `${formatStoredAgeYears(min)}+`
  return `Up to ${formatStoredAgeYears(max!)}`
}

// ── Shared types ──────────────────────────────────────────────────────────────

interface MedGroup { id: number; name: string }

interface Medication {
  id: number; name: string; default_dosage: number | null; dosage_unit: string
  notes: string | null; min_age_years: number | null; max_age_years: number | null
  is_active: number; groups: MedGroup[]
}

interface MedicationGroup {
  id: number; name: string; notes: string | null; is_active: number
  medication_count: number
}

interface FrequencyRule {
  id: number; medication_id: number | null
  min_hours_between: number; max_hours_between: number | null
  max_quantity_per_24h: number | null; max_quantity_unit: string | null
  max_per_24h_count_doses?: number | null
  min_age_years: number | null; max_age_years: number | null
  min_weight_kg: number | null
  max_weight_kg: number | null
  dosage: number | null
}

interface EditingMed {
  id?: number; name: string; default_dosage: number | null; dosage_unit: string
  notes: string | null; min_age_years: number | null; max_age_years: number | null
  is_active: number; group_ids: number[]
}

const UNITS = [...MEDICATION_DOSAGE_UNITS]

function weightRangeLabel(min: number | null, max: number | null): string {
  if (min == null && max == null) return ""
  if (min != null && max != null) return `${min}–${max} kg`
  if (min != null) return `≥${min} kg`
  return `≤${max} kg`
}

function ruleIntervalSummary(r: FrequencyRule): string {
  if (r.min_hours_between === 0) {
    return r.max_hours_between != null
      ? `0–${r.max_hours_between} h (as required)`
      : "as required"
  }
  return r.max_hours_between != null
    ? `${r.min_hours_between}–${r.max_hours_between} h`
    : `${r.min_hours_between} h`
}

function isValidRuleMinHoursBetween(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0
}

function ruleDisplay(r: FrequencyRule, catalogUnit?: string | null): string {
  const parts: string[] = [ruleIntervalSummary(r)]
  const ages = ageRangeLabel(r.min_age_years, r.max_age_years)
  if (ages) parts.push(ages)
  const w = weightRangeLabel(r.min_weight_kg, r.max_weight_kg)
  if (w) parts.push(w)
  if (r.dosage != null) {
    parts.push(catalogUnit ? `${r.dosage} ${catalogUnit}` : String(r.dosage))
  }
  if (r.max_quantity_per_24h != null) {
    if (Number(r.max_per_24h_count_doses) === 1) {
      parts.push(`≤ ${r.max_quantity_per_24h} doses / 24h`)
    } else {
      const u = catalogUnit ? ` ${catalogUnit}` : ""
      parts.push(`≤ ${r.max_quantity_per_24h}${u} / 24h`)
    }
  }
  return parts.join(" · ")
}

function medToEditing(m: Medication): EditingMed {
  return {
    id: m.id, name: m.name, default_dosage: m.default_dosage,
    dosage_unit: m.dosage_unit, notes: m.notes,
    min_age_years: m.min_age_years, max_age_years: m.max_age_years,
    is_active: m.is_active, group_ids: m.groups.map(g => g.id),
  }
}

// ── Medications tab ───────────────────────────────────────────────────────────

function MedicationsTab({ tabs }: { tabs: ReactNode }) {
  const [medications, setMedications]             = useState<Medication[]>([])
  const [editing, setEditing]                     = useState<EditingMed | null>(null)
  const [saving, setSaving]                       = useState(false)
  const [loaded, setLoaded]                       = useState(false)
  const [nameErr, setNameErr]                     = useState("")
  const formRef = useRef<HTMLDivElement>(null)
  const [allGroups, setAllGroups]                 = useState<MedGroup[]>([])
  const [editingRules, setEditingRules]           = useState<FrequencyRule[]>([])
  const [addingRule, setAddingRule]               = useState(false)
  const [newRule, setNewRule]                     = useState<Partial<FrequencyRule>>({})
  const [savingRule, setSavingRule]               = useState(false)
  const [doseOverride, setDoseOverride]           = useState(false)
  const [medAgeUnit, setMedAgeUnit]               = useState<AgeInputUnit>("years")
  const [ruleAgeUnit, setRuleAgeUnit]             = useState<AgeInputUnit>("years")
  const [editingMedRuleId, setEditingMedRuleId] = useState<number | null>(null)
  const [confirmDlg, setConfirmDlg] = useState<null | {
    title: string
    message: string
    detail?: string
    variant: ConfirmVariant
    confirmLabel?: string
    cancelLabel?: string
    showCancel?: boolean
    onConfirm: () => void | Promise<void>
  }>(null)

  async function load() {
    const res = await fetch(`/api/medications?include_inactive=1&t=${Date.now()}`)
    setMedications(await res.json())
    setLoaded(true)
  }
  useEffect(() => { load() }, [])

  useEffect(() => {
    fetch("/api/medication-groups")
      .then(r => r.json())
      .then((data: { id: number; name: string }[]) => setAllGroups(data))
  }, [])

  useEffect(() => {
    if (!editing?.id) {
      setEditingRules([])
      setAddingRule(false); setNewRule({}); setDoseOverride(false)
      setRuleAgeUnit("years"); setEditingMedRuleId(null)
      return
    }
    fetch(`/api/medications/${editing.id}/frequency-rules`)
      .then(r => r.json())
      .then((data: { rules: FrequencyRule[] }) => {
        setEditingRules(data.rules ?? [])
      })
  }, [editing?.id])

  async function handleSave() {
    if (!editing?.name?.trim()) {
      setNameErr("Enter a name.")
      setTimeout(() => { if (formRef.current) focusFirstInvalid(formRef.current) }, 0)
      return
    }
    setNameErr("")
    setSaving(true)
    const isNew = !editing.id
    const payload = {
      ...editing,
      min_age_years: ageInputToStoredYears(editing.min_age_years ?? null, medAgeUnit),
      max_age_years: ageInputToStoredYears(editing.max_age_years ?? null, medAgeUnit),
    }
    const res = await fetch(isNew ? "/api/medications" : `/api/medications/${editing.id}`, {
      method: isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
    const data = await res.json()
    await load()
    if (isNew) setEditing({ ...editing, id: data.id })
    else setEditing(null)
    setSaving(false)
  }

  function promptDeleteMedication(id: number, name: string) {
    setConfirmDlg({
      ...removeMedicationConfirmCopy(name),
      showCancel: true,
      onConfirm: async () => {
        const res = await fetch(`/api/medications/${id}`, { method: "DELETE" })
        setConfirmDlg(null)
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string }
          setConfirmDlg({
            title: "Delete failed",
            message: typeof data.error === "string" ? data.error : "Delete failed.",
            variant: "danger",
            showCancel: false,
            confirmLabel: "OK",
            onConfirm: () => setConfirmDlg(null),
          })
          return
        }
        const data = (await res.json().catch(() => ({}))) as { action?: string }
        await load()
        if (data.action === "deactivated" || data.action === "deleted") {
          setConfirmDlg({
            ...medicationRemoveResultCopy(data.action, name),
            showCancel: false,
            onConfirm: () => setConfirmDlg(null),
          })
        }
      },
    })
  }

  function startEditMedRule(r: FrequencyRule) {
    setEditingMedRuleId(r.id)
    setAddingRule(true)
    setNewRule({
      min_hours_between: r.min_hours_between,
      max_hours_between: r.max_hours_between,
      max_quantity_per_24h: r.max_quantity_per_24h,
      max_per_24h_count_doses: Number(r.max_per_24h_count_doses) === 1 ? 1 : 0,
      min_age_years: r.min_age_years,
      max_age_years: r.max_age_years,
      min_weight_kg: r.min_weight_kg,
      max_weight_kg: r.max_weight_kg,
      dosage: r.dosage,
    })
    setDoseOverride(r.dosage != null)
    setRuleAgeUnit("years")
  }

  async function handleUpdateMedRule() {
    if (!editingMedRuleId || !editing?.id || !isValidRuleMinHoursBetween(newRule.min_hours_between)) return
    setSavingRule(true)
    const payload = {
      min_hours_between: newRule.min_hours_between,
      max_hours_between: newRule.max_hours_between ?? null,
      max_quantity_per_24h: newRule.max_quantity_per_24h ?? null,
      max_per_24h_count_doses: newRule.max_quantity_per_24h != null && !!newRule.max_per_24h_count_doses,
      min_age_years: ageInputToStoredYears(newRule.min_age_years ?? null, ruleAgeUnit),
      max_age_years: ageInputToStoredYears(newRule.max_age_years ?? null, ruleAgeUnit),
      min_weight_kg: newRule.min_weight_kg ?? null,
      max_weight_kg: newRule.max_weight_kg ?? null,
      dosage: doseOverride && newRule.dosage != null ? newRule.dosage : null,
    }
    const res = await fetch(`/api/medications/${editing.id}/frequency-rules/${editingMedRuleId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const rule = (await res.json()) as FrequencyRule
    setEditingRules(rs => rs.map(x => (x.id === editingMedRuleId ? rule : x)))
    setNewRule({})
    setDoseOverride(false)
    setRuleAgeUnit("years")
    setAddingRule(false)
    setEditingMedRuleId(null)
    setSavingRule(false)
  }

  function cancelRuleForm() {
    setAddingRule(false)
    setEditingMedRuleId(null)
    setNewRule({})
    setDoseOverride(false)
    setRuleAgeUnit("years")
  }

  async function handleAddRule() {
    if (!editing?.id || !isValidRuleMinHoursBetween(newRule.min_hours_between)) return
    setSavingRule(true)
    const payload = {
      min_hours_between: newRule.min_hours_between,
      max_hours_between: newRule.max_hours_between ?? null,
      max_quantity_per_24h: newRule.max_quantity_per_24h ?? null,
      max_per_24h_count_doses: newRule.max_quantity_per_24h != null && !!newRule.max_per_24h_count_doses,
      min_age_years: ageInputToStoredYears(newRule.min_age_years ?? null, ruleAgeUnit),
      max_age_years: ageInputToStoredYears(newRule.max_age_years ?? null, ruleAgeUnit),
      min_weight_kg: newRule.min_weight_kg ?? null,
      max_weight_kg: newRule.max_weight_kg ?? null,
      dosage: doseOverride && newRule.dosage != null ? newRule.dosage : null,
    }
    const res = await fetch(`/api/medications/${editing.id}/frequency-rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
    const rule = await res.json()
    setEditingRules(rs => [...rs, rule])
    setNewRule({})
    setDoseOverride(false)
    setRuleAgeUnit("years")
    setAddingRule(false)
    setEditingMedRuleId(null)
    setSavingRule(false)
  }

  async function handleDeleteRule(ruleId: number) {
    if (!editing?.id) return
    await fetch(`/api/medications/${editing.id}/frequency-rules/${ruleId}`, { method: "DELETE" })
    setEditingRules(rs => rs.filter(r => r.id !== ruleId))
  }

  function toggleGroup(gid: number) {
    setEditing(v => {
      if (!v) return v
      const ids = v.group_ids
      return {
        ...v,
        group_ids: ids.includes(gid) ? ids.filter(id => id !== gid) : [...ids, gid],
      }
    })
  }

  return (
    <>
      <PageContainer trail={managementTrail({ label: "Medications" })} tabs={tabs}>
        {loaded && medications.length === 0 && (
          <EmptyState icon={EMPTY_STATE_ICONS.noMedications} heading="No medications yet">
            Add the first medication to the catalogue.
          </EmptyState>
        )}
        <CardList>
          {medications.map(m => (
            <ListCard
              key={m.id}
              title={m.name}
              inactive={!m.is_active}
              meta={[
                m.default_dosage ? formatUnitCount(m.default_dosage, m.dosage_unit) : null,
                ageRangeLabel(m.min_age_years, m.max_age_years),
                m.groups.length > 0 ? m.groups.map(g => g.name).join(", ") : null,
              ]}
              note={m.notes}
              extras={!m.is_active ? <Badge tone="neutral">Inactive</Badge> : undefined}
              trailing={
                <EntityRowActions
                  name={m.name}
                  onEdit={() => { setMedAgeUnit("years"); setNameErr(""); setEditing(medToEditing(m)) }}
                  onDelete={() => promptDeleteMedication(m.id, m.name)}
                />
              }
            />
          ))}
        </CardList>
        <ManagementStickyAdd
          onClick={() => {
            setMedAgeUnit("years")
            setNameErr("")
            setEditing({ name: "", dosage_unit: "Tabs", default_dosage: null, notes: null, min_age_years: null, max_age_years: null, is_active: 1, group_ids: [] })
          }}
        >
          + Add Medication
        </ManagementStickyAdd>
      </PageContainer>

      {editing && (
        <Modal open onClose={() => setEditing(null)} title={`${editing.id ? "Edit" : "Add"} medication`}>
          <div ref={formRef} className="fc-form">
            <FormField label="Name" error={nameErr || undefined}>
              <Input type="text" value={editing.name ?? ""} autoFocus
                onChange={e => { setEditing(v => ({ ...v!, name: e.target.value })); setNameErr("") }} />
            </FormField>

            {editing.id && (
              <div>
                <Toggle
                  label="Active"
                  checked={!!editing.is_active}
                  onChange={on => setEditing(v => ({ ...v!, is_active: on ? 1 : 0 }))}
                />
                <p className="fc-field__hint">
                  {editing.is_active ? "Shown in Record Medication search" : "Hidden from Record Medication search"}
                </p>
              </div>
            )}

            {allGroups.length > 0 && (
              <FieldGroup label="Active ingredients and groups" optional>
                {allGroups.map(g => (
                  <Checkbox
                    key={g.id}
                    label={g.name}
                    checked={editing.group_ids.includes(g.id)}
                    onChange={() => toggleGroup(g.id)}
                  />
                ))}
              </FieldGroup>
            )}

            <FormField label="Default dosage" optional>
              <FieldRow>
                <Input type="number" value={editing.default_dosage ?? ""} min="0" step="0.5"
                  aria-label="Default dosage amount"
                  onChange={e => setEditing(v => ({ ...v!, default_dosage: e.target.value ? parseFloat(e.target.value) : null }))} />
                <Select aria-label="Unit" value={editing.dosage_unit ?? "Tabs"}
                  onChange={e => setEditing(v => ({ ...v!, dosage_unit: e.target.value }))}>
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </Select>
              </FieldRow>
            </FormField>

            <FieldGroup
              label="Age range"
              optional
              hint="Filters medication suggestions by person age (decimal years, same as dosing rules). Leave blank for all ages."
            >
              <FieldRow>
                <Select
                  aria-label="Ages in"
                  value={medAgeUnit}
                  onChange={e => {
                    const to = e.target.value as AgeInputUnit
                    setEditing(v => {
                      if (!v) return v
                      const { min, max } = convertAgeDisplayPair(
                        v.min_age_years ?? null,
                        v.max_age_years ?? null,
                        medAgeUnit,
                        to
                      )
                      return { ...v, min_age_years: min, max_age_years: max }
                    })
                    setMedAgeUnit(to)
                  }}
                >
                  <option value="years">Ages in years</option>
                  <option value="months">Ages in months</option>
                </Select>
              </FieldRow>
              <FieldRow>
                <Input type="number" min="0" max="1500" step="any"
                  aria-label={`Minimum age in ${medAgeUnit}`}
                  value={editing.min_age_years ?? ""}
                  onChange={e => setEditing(v => ({
                    ...v!,
                    min_age_years: e.target.value === "" ? null : parseFloat(e.target.value),
                  }))}
                  placeholder="Min" />
                <Input type="number" min="0" max="1500" step="any"
                  aria-label={`Maximum age in ${medAgeUnit}`}
                  value={editing.max_age_years ?? ""}
                  onChange={e => setEditing(v => ({
                    ...v!,
                    max_age_years: e.target.value === "" ? null : parseFloat(e.target.value),
                  }))}
                  placeholder="Max" />
              </FieldRow>
              <div className="fc-form-actions">
                {[
                  { label: "Children (0–11)", min: 0, max: 11 },
                  { label: "Teens (12–17)", min: 12, max: 17 },
                  { label: "Adults (18+)", min: 18, max: null },
                ].map(preset => (
                  <Button key={preset.label} variant="secondary"
                    onClick={() => {
                      setMedAgeUnit("years")
                      setEditing(v => ({ ...v!, min_age_years: preset.min, max_age_years: preset.max }))
                    }}>
                    {preset.label}
                  </Button>
                ))}
                {(editing.min_age_years !== null || editing.max_age_years !== null) && (
                  <Button variant="quiet" onClick={() => setEditing(v => ({ ...v!, min_age_years: null, max_age_years: null }))}>
                    Clear
                  </Button>
                )}
              </div>
            </FieldGroup>

            <FormField label="Notes" optional>
              <Input type="text" value={editing.notes ?? ""} placeholder="e.g. Take with food"
                onChange={e => setEditing(v => ({ ...v!, notes: e.target.value || null }))} />
            </FormField>

            <FieldGroup label="Medication-specific rules" optional>
              {!editing.id ? (
                <p className="fc-field__hint">Save the medication first.</p>
              ) : (
                <>
                  {editingRules.length > 0 && (
                    <ul className="fc-rule-list">
                      {editingRules.map(r => (
                        <li key={r.id} className="fc-rule-row">
                          <span className="fc-rule-row__text">{ruleDisplay(r, editing.dosage_unit)}</span>
                          <Button variant="secondary" onClick={() => startEditMedRule(r)}>Edit</Button>
                          <IconButton label={`Remove rule ${ruleDisplay(r, editing.dosage_unit)}`} onClick={() => handleDeleteRule(r.id)}>
                            ✕
                          </IconButton>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!addingRule && (
                    <div>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setRuleAgeUnit("years")
                          setEditingMedRuleId(null)
                          setAddingRule(true)
                        }}
                      >
                        + Add Rule
                      </Button>
                    </div>
                  )}
                  {addingRule && (
                    <Modal
                      open
                      onClose={cancelRuleForm}
                      title={editingMedRuleId ? "Edit rule" : "New rule"}
                      backdropClassName="fixed inset-0 z-[60] bg-black/60 flex items-end justify-center p-4"
                    >
                      <div className="fc-form">
                        <FieldGroup label="Hours between doses" hint="0 = as required (no minimum time between doses)">
                          <div className="fc-form-pair">
                            <FormField label="Minimum">
                              <Input type="number" min="0" step="0.5" value={newRule.min_hours_between ?? ""}
                                onChange={e => setNewRule(r => ({ ...r, min_hours_between: e.target.value !== "" ? parseFloat(e.target.value) : undefined }))} />
                            </FormField>
                            <FormField label="Maximum" optional>
                              <Input type="number" min="0.5" step="0.5" value={newRule.max_hours_between ?? ""}
                                onChange={e => setNewRule(r => ({ ...r, max_hours_between: e.target.value !== "" ? parseFloat(e.target.value) : null }))} />
                            </FormField>
                          </div>
                        </FieldGroup>

                        <FieldGroup label="Age and weight" optional>
                          <FormField label="Ages in">
                            <Select
                              value={ruleAgeUnit}
                              onChange={e => {
                                const to = e.target.value as AgeInputUnit
                                setNewRule(r => {
                                  const { min, max } = convertAgeDisplayPair(
                                    r.min_age_years ?? null,
                                    r.max_age_years ?? null,
                                    ruleAgeUnit,
                                    to
                                  )
                                  return { ...r, min_age_years: min, max_age_years: max }
                                })
                                setRuleAgeUnit(to)
                              }}
                            >
                              <option value="years">Years</option>
                              <option value="months">Months</option>
                            </Select>
                          </FormField>
                          <div className="fc-form-pair">
                            <FormField label="Age minimum">
                              <Input type="number" min="0" max="1500" step="any" value={newRule.min_age_years ?? ""}
                                onChange={e => setNewRule(r => ({
                                  ...r,
                                  min_age_years: e.target.value === "" ? null : parseFloat(e.target.value),
                                }))} />
                            </FormField>
                            <FormField label="Age maximum">
                              <Input type="number" min="0" max="1500" step="any" value={newRule.max_age_years ?? ""}
                                onChange={e => setNewRule(r => ({
                                  ...r,
                                  max_age_years: e.target.value === "" ? null : parseFloat(e.target.value),
                                }))} />
                            </FormField>
                          </div>
                          <div className="fc-form-pair">
                            <FormField label="Weight minimum (kg)">
                              <Input type="number" min="0" step="0.1" value={newRule.min_weight_kg ?? ""}
                                onChange={e => setNewRule(r => ({ ...r, min_weight_kg: e.target.value === "" ? null : parseFloat(e.target.value) }))} />
                            </FormField>
                            <FormField label="Weight maximum (kg)">
                              <Input type="number" min="0" step="0.1" value={newRule.max_weight_kg ?? ""}
                                onChange={e => setNewRule(r => ({ ...r, max_weight_kg: e.target.value === "" ? null : parseFloat(e.target.value) }))} />
                            </FormField>
                          </div>
                        </FieldGroup>

                        <FieldGroup label="Dosage" optional>
                          <FormField
                            label="Maximum per 24 hours"
                            hint={newRule.max_per_24h_count_doses ? "Counted in doses" : `Counted in ${editing.dosage_unit}`}
                          >
                            <Input type="number" min="0" step="0.5" value={newRule.max_quantity_per_24h ?? ""}
                              onChange={e => setNewRule(r => ({
                                ...r,
                                max_quantity_per_24h: e.target.value ? parseFloat(e.target.value) : null,
                                max_per_24h_count_doses: e.target.value ? (r.max_per_24h_count_doses ?? 0) : 0,
                              }))} />
                          </FormField>
                          <Checkbox
                            label="24h maximum is a number of doses (not a total amount)"
                            checked={!!newRule.max_per_24h_count_doses}
                            disabled={!newRule.max_quantity_per_24h}
                            onChange={e => setNewRule(r => ({
                              ...r,
                              max_per_24h_count_doses: e.target.checked ? 1 : 0,
                            }))}
                          />
                          <Checkbox
                            label="Dose override"
                            checked={doseOverride}
                            onChange={e => {
                              const on = e.target.checked
                              setDoseOverride(on)
                              if (!on) setNewRule(r => ({ ...r, dosage: null }))
                            }}
                          />
                          {doseOverride && (
                            <FormField label="Override dose">
                              <Input type="number" min="0" step="0.5" value={newRule.dosage ?? ""}
                                onChange={e => setNewRule(r => ({
                                  ...r,
                                  dosage: e.target.value === "" ? null : parseFloat(e.target.value),
                                }))} />
                            </FormField>
                          )}
                        </FieldGroup>

                        <div className="fc-form-actions">
                          <Button variant="secondary" onClick={cancelRuleForm}>Cancel</Button>
                          {isValidRuleMinHoursBetween(newRule.min_hours_between) ? (
                            <Button onClick={() => (editingMedRuleId ? void handleUpdateMedRule() : void handleAddRule())} pending={savingRule}>
                              {editingMedRuleId ? "Save" : "Add"}
                            </Button>
                          ) : (
                            <Button disabled disabledReason="Enter the minimum hours between doses first.">
                              {editingMedRuleId ? "Save" : "Add"}
                            </Button>
                          )}
                        </div>
                      </div>
                    </Modal>
                  )}
                </>
              )}
            </FieldGroup>

            <div className="fc-form-actions">
              <Button variant="secondary" onClick={() => setEditing(null)}>
                {editing.id ? "Close" : "Cancel"}
              </Button>
              <Button onClick={handleSave} pending={saving}>
                {editing.id ? "Save changes" : "Save"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {confirmDlg && (
        <ConfirmModal
          open
          title={confirmDlg.title}
          message={confirmDlg.message}
          detail={confirmDlg.detail}
          variant={confirmDlg.variant}
          confirmLabel={confirmDlg.confirmLabel}
          cancelLabel={confirmDlg.cancelLabel}
          showCancel={confirmDlg.showCancel ?? true}
          onCancel={() => setConfirmDlg(null)}
          onConfirm={confirmDlg.onConfirm}
        />
      )}
    </>
  )
}

// ── Groups tab ────────────────────────────────────────────────────────────────

function GroupsTab({ tabs }: { tabs: ReactNode }) {
  const [groups, setGroups]           = useState<MedicationGroup[]>([])
  const [loaded, setLoaded]           = useState(false)
  const [editing, setEditing]         = useState<Partial<MedicationGroup> | null>(null)
  const [saving, setSaving]           = useState(false)
  const [deleteError, setDeleteError] = useState("")
  const [nameErr, setNameErr]         = useState("")
  const formRef = useRef<HTMLDivElement>(null)

  async function load() {
    const res = await fetch("/api/medication-groups")
    setGroups(await res.json())
    setLoaded(true)
  }
  useEffect(() => { load() }, [])

  async function handleSave() {
    if (!editing?.name?.trim()) {
      setNameErr("Enter a name.")
      setTimeout(() => { if (formRef.current) focusFirstInvalid(formRef.current) }, 0)
      return
    }
    setNameErr("")
    setSaving(true)
    const isNew = !editing.id
    const url = isNew ? "/api/medication-groups" : `/api/medication-groups/${editing.id}`
    const res = await fetch(url, {
      method: isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editing.name, notes: editing.notes })
    })
    const data = await res.json()
    await load()
    if (isNew) setEditing({ ...data, medication_count: 0 })
    else setEditing(null)
    setSaving(false)
  }

  async function handleDelete(id: number) {
    setDeleteError("")
    const res = await fetch(`/api/medication-groups/${id}`, { method: "DELETE" })
    if (!res.ok) {
      const data = await res.json()
      setDeleteError(data.error ?? "Failed to delete group")
      return
    }
    await load()
  }

  return (
    <>
      <PageContainer trail={managementTrail({ label: "Medications" })} tabs={tabs}>
        {deleteError && <Banner kind="error" announced>{deleteError}</Banner>}
        {loaded && groups.length === 0 && (
          <EmptyState icon={EMPTY_STATE_ICONS.noMedications} heading="No groups yet">
            Add a group to link medications that share an active ingredient.
          </EmptyState>
        )}
        <CardList>
          {groups.map(g => (
            <ListCard
              key={g.id}
              title={g.name}
              meta={[`${formatCount(g.medication_count, "medication")} linked`]}
              note={g.notes}
              trailing={
                <EntityRowActions
                  name={g.name}
                  onEdit={() => { setDeleteError(""); setNameErr(""); setEditing(g) }}
                  onDelete={() => handleDelete(g.id)}
                />
              }
            />
          ))}
        </CardList>
        <ManagementStickyAdd
          onClick={() => { setDeleteError(""); setNameErr(""); setEditing({ name: "", notes: null }) }}
        >
          + Add Group
        </ManagementStickyAdd>
      </PageContainer>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`${editing?.id ? "Edit" : "Add"} group`}>
        <div ref={formRef} className="fc-form">
          <FormField label="Name" error={nameErr || undefined}>
            <Input type="text" value={editing?.name ?? ""} autoFocus
              onChange={e => { setEditing(v => ({ ...v!, name: e.target.value })); setNameErr("") }} />
          </FormField>

          <FormField label="Notes" optional>
            <Input type="text" value={editing?.notes ?? ""} placeholder="e.g. Paracetamol-based"
              onChange={e => setEditing(v => ({ ...v!, notes: e.target.value || null }))} />
          </FormField>

          <div className="fc-form-actions">
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {editing?.id ? "Close" : "Cancel"}
            </Button>
            <Button onClick={handleSave} pending={saving}>
              {editing?.id ? "Save changes" : "Save"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type TabKey = "medications" | "groups"

const MEDICATION_PAGE_TABS: FcTabItem<TabKey>[] = [
  { value: "medications", label: "Medications" },
  { value: "groups", label: "Groups" },
]

function MedicationsPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const tab: TabKey = searchParams.get("tab") === "groups" ? "groups" : "medications"
  const tabBar = (
    <FcTabBar
      tabs={MEDICATION_PAGE_TABS}
      active={tab}
      onSelect={t => router.push(`?tab=${t}`)}
    />
  )

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Medications" />

      {tab === "medications" ? <MedicationsTab tabs={tabBar} /> : <GroupsTab tabs={tabBar} />}

      <AppFooter />
    </div>
  )
}

export default function ManagementMedicationsPage() {
  return (
    <Suspense fallback={<div className="flex flex-col flex-1 min-h-0 fc-surface-app" />}>
      <MedicationsPageContent />
    </Suspense>
  )
}
