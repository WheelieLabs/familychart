// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { Suspense, useState, useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import FormField from "@/components/FormField"
import Modal from "@/components/Modal"
import ConfirmModal, {
  medicationRemoveResultCopy,
  removeMedicationConfirmCopy,
  type ConfirmVariant,
} from "@/components/ConfirmModal"
import {
  CatalogActiveStatusButton,
  EntityRowDeleteButton,
  EntityRowEditButton,
  InactiveCatalogBadge,
  ModalRowRemoveIconButton,
} from "@/components/EntityRowActions"
import { FcTabBar, type FcTabItem } from "@/components/FcTabBar"
import ManagementStickyAdd from "@/components/ManagementStickyAdd"
import { mainContentTargetProps } from "@/lib/a11y"
import { formatCount, formatUnitCount } from "@/lib/format-count"
import { MEDICATION_DOSAGE_UNITS } from "@/lib/medication/medication-units"
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

function MedicationsTab() {
  const [medications, setMedications]             = useState<Medication[]>([])
  const [editing, setEditing]                     = useState<EditingMed | null>(null)
  const [saving, setSaving]                       = useState(false)
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
    if (!editing?.name?.trim()) return
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
      <main {...mainContentTargetProps} className="fc-surface-app fc-scroll flex flex-col min-h-0">
        <div className="flex flex-col gap-3 p-3 flex-1">
        {medications.map(m => (
          <div key={m.id} className={`rounded-xl px-4 py-3 flex items-center gap-3 ${m.is_active ? "bg-white/10" : "bg-white/5"}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-white font-bold truncate">{m.name}</span>
                {!m.is_active && <InactiveCatalogBadge />}
              </div>
              <div className="text-white text-xs flex gap-3 flex-wrap">
                {m.default_dosage && <span>{formatUnitCount(m.default_dosage, m.dosage_unit)}</span>}
                {ageRangeLabel(m.min_age_years, m.max_age_years) && (
                  <span>{ageRangeLabel(m.min_age_years, m.max_age_years)}</span>
                )}
                {m.groups.length > 0 && (
                  <span>{m.groups.map(g => g.name).join(", ")}</span>
                )}
              </div>
              {m.notes && <div className="text-white text-sm whitespace-normal break-words">{m.notes}</div>}
            </div>
            <EntityRowEditButton onClick={() => { setMedAgeUnit("years"); setEditing(medToEditing(m)) }} />
            <EntityRowDeleteButton onClick={() => promptDeleteMedication(m.id, m.name)} />
          </div>
        ))}
        </div>
        <ManagementStickyAdd
          onClick={() => {
            setMedAgeUnit("years")
            setEditing({ name: "", dosage_unit: "Tabs", default_dosage: null, notes: null, min_age_years: null, max_age_years: null, is_active: 1, group_ids: [] })
          }}
        >
          + Add Medication
        </ManagementStickyAdd>
      </main>

      {editing && (
        <Modal open onClose={() => setEditing(null)} title={`${editing.id ? "Edit" : "Add"} Medication`}>
            <FormField label="Name">
              <input type="text" value={editing.name ?? ""} autoFocus
                onChange={e => setEditing(v => ({ ...v!, name: e.target.value }))}
                className="w-full border border-gray-300 rounded px-3 py-2 text-gray-800" />
            </FormField>

            {editing.id && (
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-gray-700">Status</div>
                  <div className="text-xs text-gray-500">
                    {editing.is_active ? "Shown in Record Medication search" : "Hidden from Record Medication search"}
                  </div>
                </div>
                <CatalogActiveStatusButton
                  active={!!editing.is_active}
                  onClick={() => setEditing(v => ({ ...v!, is_active: v!.is_active ? 0 : 1 }))}
                />
              </div>
            )}

            {allGroups.length > 0 && (
              <div>
                <label className="text-sm font-bold text-gray-700 block mb-2">Active Ingredients / Groups</label>
                <div className="flex flex-col gap-1.5">
                  {allGroups.map(g => (
                    <label key={g.id} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox"
                        checked={editing.group_ids.includes(g.id)}
                        onChange={() => toggleGroup(g.id)}
                        className="w-4 h-4 accent-fc-blue" />
                      <span className="text-sm text-gray-700">{g.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="text-sm font-bold text-gray-700 block mb-1">Default Dosage</label>
              <div className="flex gap-2">
                <input type="number" value={editing.default_dosage ?? ""} min="0" step="0.5"
                  onChange={e => setEditing(v => ({ ...v!, default_dosage: e.target.value ? parseFloat(e.target.value) : null }))}
                  className="w-24 border border-gray-300 rounded px-3 py-2 text-gray-800" />
                <select value={editing.dosage_unit ?? "Tabs"}
                  onChange={e => setEditing(v => ({ ...v!, dosage_unit: e.target.value }))}
                  className="flex-1 bg-fc-blue text-white font-bold border border-gray-300 rounded px-3 py-2">
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="text-sm font-bold text-gray-700 block mb-1">Age range (optional)</label>
              <p className="text-xs text-gray-500 mb-2">
                Filters medication suggestions by person age (decimal years, same as dosing rules). Leave blank for all ages.
              </p>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-xs text-gray-600">Ages in</span>
                <select
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
                  className="text-xs border border-gray-300 rounded px-2 py-1.5 text-gray-800 bg-white"
                >
                  <option value="years">Years</option>
                  <option value="months">Months</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" min="0" max="1500" step="any"
                  value={editing.min_age_years ?? ""}
                  onChange={e => setEditing(v => ({
                    ...v!,
                    min_age_years: e.target.value === "" ? null : parseFloat(e.target.value),
                  }))}
                  placeholder="Min"
                  className="w-24 border border-gray-300 rounded px-3 py-2 text-gray-800 text-center" />
                <span className="text-gray-600 text-sm">to</span>
                <input type="number" min="0" max="1500" step="any"
                  value={editing.max_age_years ?? ""}
                  onChange={e => setEditing(v => ({
                    ...v!,
                    max_age_years: e.target.value === "" ? null : parseFloat(e.target.value),
                  }))}
                  placeholder="Max"
                  className="w-24 border border-gray-300 rounded px-3 py-2 text-gray-800 text-center" />
                <span className="text-gray-600 text-sm">{medAgeUnit === "months" ? "mo" : "yrs"}</span>
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                {[
                  { label: "Children (0–11)", min: 0, max: 11 },
                  { label: "Teens (12–17)", min: 12, max: 17 },
                  { label: "Adults (18+)", min: 18, max: null },
                ].map(preset => (
                  <button key={preset.label}
                    onClick={() => {
                      setMedAgeUnit("years")
                      setEditing(v => ({ ...v!, min_age_years: preset.min, max_age_years: preset.max }))
                    }}
                    className="text-xs bg-fc-blue/20 hover:bg-fc-blue/30 text-gray-700 px-2 py-1
                               rounded border border-gray-300 transition-colors">
                    {preset.label}
                  </button>
                ))}
                {(editing.min_age_years !== null || editing.max_age_years !== null) && (
                  <button onClick={() => setEditing(v => ({ ...v!, min_age_years: null, max_age_years: null }))}
                    className="text-xs text-red-500 underline px-1">Clear</button>
                )}
              </div>
            </div>

            <div>
              <label className="text-sm font-bold text-gray-700 block mb-1">Notes</label>
              <input type="text" value={editing.notes ?? ""} placeholder="e.g. Take with food"
                onChange={e => setEditing(v => ({ ...v!, notes: e.target.value || null }))}
                className="w-full border border-gray-300 rounded px-3 py-2 text-gray-800" />
            </div>


            <div>
              <label className="text-sm font-bold text-gray-700 block mb-2">Medication-specific Rules</label>
              {!editing.id ? (
                <p className="text-xs text-gray-500">Save the medication first.</p>
              ) : (
                <>
                  {editingRules.length > 0 && (
                    <div className="flex flex-col gap-1 mb-2">
                      {editingRules.map(r => (
                        <div key={r.id}
                          className="flex items-center justify-between gap-2 bg-white rounded px-3 py-2
                                     text-xs text-gray-700 border border-gray-200">
                          <span className="min-w-0 break-words">{ruleDisplay(r, editing.dosage_unit)}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => startEditMedRule(r)}
                              className="text-fc-blue font-bold text-xs"
                            >
                              Edit
                            </button>
                            <ModalRowRemoveIconButton onClick={() => handleDeleteRule(r.id)} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {!addingRule && (
                    <button
                      type="button"
                      onClick={() => {
                        setRuleAgeUnit("years")
                        setEditingMedRuleId(null)
                        setAddingRule(true)
                      }}
                      className="text-sm text-fc-blue underline">+ Add Rule</button>
                  )}
                  {addingRule && (
                    <Modal
                      open
                      onClose={cancelRuleForm}
                      title={editingMedRuleId ? "Edit rule" : "New rule"}
                      backdropClassName="fixed inset-0 z-[60] bg-black/60 flex items-end justify-center p-4"
                      panelClassName="bg-white rounded-2xl w-full max-w-sm p-5 flex flex-col gap-2 max-h-[90vh] overflow-y-auto text-sm"
                      titleClassName="text-xs font-bold text-gray-800"
                    >
                      <p className="text-xs font-bold text-gray-700">Frequency (hours)</p>
                      <p className="text-xs text-gray-500">
                        0 = as required (no minimum time between doses)
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-gray-600">Min *</label>
                          <input type="number" min="0" step="0.5" value={newRule.min_hours_between ?? ""}
                            onChange={e => setNewRule(r => ({ ...r, min_hours_between: e.target.value !== "" ? parseFloat(e.target.value) : undefined }))}
                            className="w-full border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                        </div>
                        <div>
                          <label className="text-xs text-gray-600">Max</label>
                          <input type="number" min="0.5" step="0.5" value={newRule.max_hours_between ?? ""}
                            onChange={e => setNewRule(r => ({ ...r, max_hours_between: e.target.value !== "" ? parseFloat(e.target.value) : null }))}
                            className="w-full border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                        </div>
                      </div>
                      <p className="text-xs font-bold text-gray-700">Age / Weight</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-gray-600">Rule ages in</span>
                        <select
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
                          className="text-xs border border-gray-300 rounded px-2 py-1.5 text-gray-800 bg-white"
                        >
                          <option value="years">Years</option>
                          <option value="months">Months</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-gray-600">Age min</label>
                          <input type="number" min="0" max="1500" step="any" value={newRule.min_age_years ?? ""}
                            onChange={e => setNewRule(r => ({
                              ...r,
                              min_age_years: e.target.value === "" ? null : parseFloat(e.target.value),
                            }))}
                            className="w-full border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                        </div>
                        <div>
                          <label className="text-xs text-gray-600">Age max</label>
                          <input type="number" min="0" max="1500" step="any" value={newRule.max_age_years ?? ""}
                            onChange={e => setNewRule(r => ({
                              ...r,
                              max_age_years: e.target.value === "" ? null : parseFloat(e.target.value),
                            }))}
                            className="w-full border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-gray-600">Weight min (kg)</label>
                          <input type="number" min="0" step="0.1" value={newRule.min_weight_kg ?? ""}
                            onChange={e => setNewRule(r => ({ ...r, min_weight_kg: e.target.value === "" ? null : parseFloat(e.target.value) }))}
                            className="w-full border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                        </div>
                        <div>
                          <label className="text-xs text-gray-600">Weight max (kg)</label>
                          <input type="number" min="0" step="0.1" value={newRule.max_weight_kg ?? ""}
                            onChange={e => setNewRule(r => ({ ...r, max_weight_kg: e.target.value === "" ? null : parseFloat(e.target.value) }))}
                            className="w-full border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                        </div>
                      </div>
                      <p className="text-xs font-bold text-gray-700">Dosage</p>
                      <div className="flex gap-2 items-end">
                        <div className="flex-1 min-w-0">
                          <label className="text-xs text-gray-600">Max / 24h</label>
                          <input type="number" min="0" step="0.5" value={newRule.max_quantity_per_24h ?? ""}
                            onChange={e => setNewRule(r => ({
                              ...r,
                              max_quantity_per_24h: e.target.value ? parseFloat(e.target.value) : null,
                              max_per_24h_count_doses: e.target.value ? (r.max_per_24h_count_doses ?? 0) : 0,
                            }))}
                            className="w-full border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                        </div>
                        {!newRule.max_per_24h_count_doses && (
                          <span className="text-xs text-gray-500 pb-2 shrink-0">{editing.dosage_unit}</span>
                        )}
                      </div>
                      <label className="flex items-center gap-2 text-xs text-gray-800 cursor-pointer select-none">
                        <input type="checkbox"
                          checked={!!newRule.max_per_24h_count_doses}
                          disabled={!newRule.max_quantity_per_24h}
                          onChange={e => setNewRule(r => ({
                            ...r,
                            max_per_24h_count_doses: e.target.checked ? 1 : 0,
                          }))}
                          className="rounded border-gray-300 disabled:opacity-40" />
                        24h max is number of doses (not total amount)
                      </label>
                      <label className="flex items-center gap-2 text-xs text-gray-800 cursor-pointer select-none">
                        <input type="checkbox" checked={doseOverride}
                          onChange={e => {
                            const on = e.target.checked
                            setDoseOverride(on)
                            if (!on) setNewRule(r => ({ ...r, dosage: null }))
                          }}
                          className="rounded border-gray-300" />
                        Dose override
                      </label>
                      {doseOverride && (
                        <input type="number" min="0" step="0.5" value={newRule.dosage ?? ""}
                          onChange={e => setNewRule(r => ({
                            ...r,
                            dosage: e.target.value === "" ? null : parseFloat(e.target.value),
                          }))}
                          className="w-full border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                      )}
                      <div className="flex gap-2 mt-1">
                        <button type="button" onClick={cancelRuleForm}
                          className="flex-1 border border-gray-300 rounded-lg py-2 text-sm text-gray-600">
                          Cancel
                        </button>
                        <button type="button" onClick={() => (editingMedRuleId ? void handleUpdateMedRule() : void handleAddRule())} disabled={savingRule || !isValidRuleMinHoursBetween(newRule.min_hours_between)}
                          className="flex-1 bg-fc-blue text-white rounded-lg py-2 text-sm font-bold disabled:opacity-50">
                          {savingRule ? "Saving…" : editingMedRuleId ? "Save" : "Add"}
                        </button>
                      </div>
                    </Modal>
                  )}
                </>
              )}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setEditing(null)}
                className="flex-1 border border-gray-400 rounded-xl py-3 text-gray-700 font-bold">
                {editing.id ? "Close" : "Cancel"}
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 bg-fc-blue text-white font-bold rounded-xl py-3 disabled:opacity-50">
                {saving ? "Saving…" : editing.id ? "Save changes" : "Save"}
              </button>
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

function GroupsTab() {
  const [groups, setGroups]           = useState<MedicationGroup[]>([])
  const [editing, setEditing]         = useState<Partial<MedicationGroup> | null>(null)
  const [saving, setSaving]           = useState(false)
  const [deleteError, setDeleteError] = useState("")

  async function load() {
    const res = await fetch("/api/medication-groups")
    setGroups(await res.json())
  }
  useEffect(() => { load() }, [])

  async function handleSave() {
    if (!editing?.name?.trim()) return
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
      <main {...mainContentTargetProps} className="fc-surface-app fc-scroll flex flex-col min-h-0">
        <div className="flex flex-col gap-3 p-3 flex-1">
        {deleteError && (
          <div className="bg-red-100 border border-red-300 text-red-700 rounded-xl px-4 py-3 text-sm">
            {deleteError}
          </div>
        )}
        {groups.map(g => (
          <div key={g.id} className="bg-white/10 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-white font-bold truncate">{g.name}</div>
              <div className="text-white text-xs">
                {g.medication_count} medication{g.medication_count !== 1 ? "s" : ""} linked
              </div>
              {g.notes && <div className="text-white text-sm whitespace-normal break-words">{g.notes}</div>}
            </div>
            <EntityRowEditButton onClick={() => { setDeleteError(""); setEditing(g) }} />
            <EntityRowDeleteButton onClick={() => handleDelete(g.id)} />
          </div>
        ))}
        </div>
        <ManagementStickyAdd
          onClick={() => { setDeleteError(""); setEditing({ name: "", notes: null }) }}
        >
          + Add Group
        </ManagementStickyAdd>
      </main>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`${editing?.id ? "Edit" : "Add"} Group`}>
        <FormField label="Name">
          <input type="text" value={editing?.name ?? ""} autoFocus
            onChange={e => setEditing(v => ({ ...v!, name: e.target.value }))}
            className="w-full border border-gray-300 rounded px-3 py-2 text-gray-800" />
        </FormField>

        <FormField label="Notes">
          <input type="text" value={editing?.notes ?? ""} placeholder="e.g. Paracetamol-based"
            onChange={e => setEditing(v => ({ ...v!, notes: e.target.value || null }))}
            className="w-full border border-gray-300 rounded px-3 py-2 text-gray-800" />
        </FormField>

        <div className="flex gap-3">
          <button onClick={() => setEditing(null)}
            className="flex-1 border border-gray-400 rounded-xl py-3 text-gray-700 font-bold">
            {editing?.id ? "Close" : "Cancel"}
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 bg-fc-blue text-white font-bold rounded-xl py-3 disabled:opacity-50">
            {saving ? "Saving…" : editing?.id ? "Save changes" : "Save"}
          </button>
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

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Medications" />

      <FcTabBar
        tabs={MEDICATION_PAGE_TABS}
        active={tab}
        onSelect={t => router.push(`?tab=${t}`)}
      />

      {tab === "medications" ? <MedicationsTab /> : <GroupsTab />}

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
