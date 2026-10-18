// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import ConfirmModal, { confirmCopy } from "@/components/ConfirmModal"
import DoseExpectationsPanel from "@/components/DoseExpectationsPanel"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import Chip from "@/components/ui/Chip"
import { Input, Select } from "@/components/ui/controls"
import DateEcho from "@/components/ui/DateEcho"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import EntityRowActions from "@/components/ui/EntityRowActions"
import FormField, { FieldGroup, FieldRow } from "@/components/ui/FormField"
import ListCard, { CardList } from "@/components/ui/ListCard"
import Panel from "@/components/ui/Panel"
import SuggestionList from "@/components/ui/SuggestionList"
import { getDeviceTimeZone } from "@/lib/date-format"
import {
  parseScheduleSlotsJson,
  parseScheduleTimeUserInput,
  parseScheduleTimesJson,
  parseScheduleFrequencyUnknown,
  type MedScheduleFreq,
} from "@/lib/medication/medication-schedule"

const PRESET_TIMES = ["06:00", "08:00", "12:00", "18:00", "20:00", "22:00"] as const
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

interface PersonMedicationRow {
  id: number
  person_id: number
  medication_id: number
  is_active: number
  schedule_times: string | null
  schedule_slots: string | null
  schedule_frequency: string | null
  schedule_start_date: string | null
  schedule_end_date: string | null
  schedule_tz: string | null
  medication_name: string
  dosage_unit: string | null
  default_dosage: number | null
}

interface MedicationSuggestion {
  id: number
  name: string
  dosage_unit: string
}

interface RowEditorState {
  times: Set<string>
  slotDosages: Record<string, string>
  freq: MedScheduleFreq
  startDate: string
  endDate: string
  customTimeInput: string
}

function defaultAmt(row: PersonMedicationRow): string {
  if (row.default_dosage != null && Number.isFinite(row.default_dosage) && row.default_dosage > 0) {
    return String(row.default_dosage)
  }
  return "1"
}

function rowToEditor(r: PersonMedicationRow): RowEditorState {
  const freq = parseScheduleFrequencyUnknown(r.schedule_frequency)
  const times = parseScheduleTimesJson(r.schedule_times)
  const slots = parseScheduleSlotsJson(r.schedule_slots)
  const slotDosages: Record<string, string> = {}
  const fb = defaultAmt(r)
  for (const t of times) {
    const hit = slots.find(s => s.time === t)
    slotDosages[t] = hit ? String(hit.dosage) : fb
  }
  return {
    times: new Set(times),
    slotDosages,
    freq,
    startDate: r.schedule_start_date ?? "",
    endDate: r.schedule_end_date ?? "",
    customTimeInput: "",
  }
}

/** Daily derives its per-day dose count from however many times are scheduled,
 * so the label scales to any count — once, twice, three times, and so on —
 * without a dedicated option per count. */
function timesPerDayLabel(timesCount: number): string {
  if (timesCount <= 1) return "Daily"
  if (timesCount === 2) return "Twice daily"
  return `${timesCount} times daily`
}

function summarizeFreq(freq: MedScheduleFreq, timesCount: number): string {
  switch (freq.kind) {
    case "daily":
      return timesPerDayLabel(timesCount)
    case "every_n_days":
      return `Every ${freq.n} days`
    case "weekly":
      return `Weekly (${[...freq.weekdays].sort((a, b) => a - b).map(d => WEEKDAY_LABELS[d]).join(", ")})`
    default:
      return ""
  }
}

function summarizeScheduleRow(row: PersonMedicationRow, ed: RowEditorState): string {
  if (Number(row.is_active) !== 1) return "Inactive on this profile"
  const ta = [...ed.times].sort()
  const unit = row.dosage_unit ? ` ${row.dosage_unit}` : ""
  if (ta.length === 0) return `No scheduled times · ${summarizeFreq(ed.freq, ta.length)}`
  const doseParts = ta.map(t => {
    const raw = ed.slotDosages[t]?.trim() ?? ""
    const amt = raw !== "" && Number.isFinite(parseFloat(raw)) ? raw : "?"
    return `${t} (${amt}${unit})`
  })
  const datePart = ed.startDate ? ` · from ${ed.startDate}` : ""
  return doseParts.join(", ") + " · " + summarizeFreq(ed.freq, ta.length) + datePart
}

export default function MedicationSchedulesContent({ personId }: { personId: string }) {
  const [rows, setRows] = useState<PersonMedicationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [editors, setEditors] = useState<Record<number, RowEditorState>>({})
  const [expandedPmIds, setExpandedPmIds] = useState<Set<number>>(() => new Set())
  const [savingPmId, setSavingPmId] = useState<number | null>(null)

  const [addQuery, setAddQuery] = useState("")
  const [addSuggestions, setAddSuggestions] = useState<MedicationSuggestion[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [addingId, setAddingId] = useState<number | null>(null)
  const [removePmId, setRemovePmId] = useState<number | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const pmRes = await fetch(`/api/people/${personId}/person-medications`)

      const listUnknown = pmRes.ok ? await pmRes.json() : []
      const list = Array.isArray(listUnknown)
        ? (listUnknown as PersonMedicationRow[]).slice()
        : []
      list.sort((a, b) => {
        const ac = Number(a.is_active) === 1 ? 0 : 1
        const bc = Number(b.is_active) === 1 ? 0 : 1
        if (ac !== bc) return ac - bc
        return a.medication_name.localeCompare(b.medication_name, undefined, { sensitivity: "base" })
      })
      setRows(list)
      const nextEd: Record<number, RowEditorState> = {}
      for (const r of list) {
        nextEd[r.id] = rowToEditor(r)
      }
      setEditors(nextEd)

      const clientTz = getDeviceTimeZone()
      const nullTzRows = list.filter(r => r.schedule_times != null && r.schedule_tz == null)
      if (nullTzRows.length > 0) {
        await Promise.allSettled(
          nullTzRows.map(r =>
            fetch(`/api/people/${personId}/person-medications?id=${r.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tz: clientTz }),
            })
          )
        )
      }
    } catch {
      setError("Failed to load medications.")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [personId])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    const q = addQuery.trim()
    if (q.length < 1) {
      setAddSuggestions([])
      return
    }
    const t = window.setTimeout(() => {
      fetch(`/api/medications?q=${encodeURIComponent(q)}&person_id=${personId}`)
        .then(r => r.json())
        .then((data: MedicationSuggestion[]) => {
          if (Array.isArray(data)) setAddSuggestions(data)
          else setAddSuggestions([])
        })
        .catch(() => setAddSuggestions([]))
    }, 200)
    return () => window.clearTimeout(t)
  }, [addQuery, personId])

  // A medication counts as "scheduled" only when it has at least one configured slot time.
  // PRN/ad-hoc assignments (created by recording a dose) have no times and are intentionally
  // not shown here; suppressing only the scheduled meds from the catalogue search lets a
  // manager pick such a PRN medication to bring it into the schedule.
  const hasScheduledTimes = useCallback(
    (r: PersonMedicationRow) => parseScheduleTimesJson(r.schedule_times).length > 0,
    [],
  )
  const scheduledMedIds = useMemo(
    () => new Set(rows.filter(r => r.is_active === 1 && hasScheduledTimes(r)).map(r => r.medication_id)),
    [rows, hasScheduledTimes],
  )

  // Show a row when it actually has a schedule, or while it is expanded for editing (a newly
  // assigned row opens expanded with no times yet so the manager can configure it).
  const visibleRows = useMemo(
    () => rows.filter(r => hasScheduledTimes(r) || expandedPmIds.has(r.id)),
    [rows, expandedPmIds, hasScheduledTimes],
  )

  function toggleExpanded(pmId: number) {
    setExpandedPmIds(prev => {
      const n = new Set(prev)
      if (n.has(pmId)) n.delete(pmId)
      else n.add(pmId)
      return n
    })
  }

  function updateEditor(pmId: number, patch: Partial<RowEditorState>) {
    setEditors(e => ({
      ...e,
      [pmId]: { ...(e[pmId] ?? rowToEditor(rows.find(r => r.id === pmId)!)), ...patch },
    }))
  }

  async function handleSave(pmId: number) {
    const ed = editors[pmId]
    const row = rows.find(r => r.id === pmId)
    if (!ed || !row) return

    const timeArr = [...ed.times].sort()

    if (timeArr.length > 0 && !ed.startDate.trim()) {
      setError("Start date is required when times are scheduled.")
      return
    }
    if (ed.freq.kind === "weekly" && ed.freq.weekdays.length === 0) {
      setError("Weekly: choose at least one weekday.")
      return
    }

    let schedule_slots: { time: string; dosage: number }[] = []
    if (timeArr.length > 0) {
      for (const t of timeArr) {
        const raw = ed.slotDosages[t]?.trim() ?? ""
        const d = parseFloat(raw)
        if (!Number.isFinite(d) || d <= 0) {
          setError(`Enter a positive dose amount for ${t} (${row.medication_name}).`)
          return
        }
        schedule_slots.push({ time: t, dosage: d })
      }
    }

    setError("")
    setSavingPmId(pmId)
    const body: Record<string, unknown> = {
      schedule_times: timeArr,
      schedule_slots,
      schedule_frequency: ed.freq,
      schedule_start_date: timeArr.length > 0 ? ed.startDate : null,
      schedule_end_date: timeArr.length > 0 ? ed.endDate.trim() || null : null,
      tz: getDeviceTimeZone(),
    }

    try {
      const res = await fetch(`/api/people/${personId}/person-medications?id=${pmId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(typeof j.error === "string" ? j.error : "Could not save schedule.")
        return
      }
      setExpandedPmIds(prev => {
        const n = new Set(prev)
        n.delete(pmId)
        return n
      })
      await loadAll()
    } finally {
      setSavingPmId(null)
    }
  }

  async function confirmRemoveFromSchedule() {
    if (removePmId == null) return
    const pmId = removePmId
    setError("")
    try {
      const res = await fetch(`/api/people/${personId}/person-medications?id=${pmId}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        setError("Could not remove medication.")
        return
      }
      setExpandedPmIds(prev => {
        const n = new Set(prev)
        n.delete(pmId)
        return n
      })
      await loadAll()
    } finally {
      setRemovePmId(null)
    }
  }

  async function handleRestore(pmId: number) {
    setError("")
    const res = await fetch(`/api/people/${personId}/person-medications?id=${pmId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: true, tz: getDeviceTimeZone() }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(typeof j.error === "string" ? j.error : "Could not restore.")
      return
    }
    await loadAll()
  }

  async function handleAddMedication(med: MedicationSuggestion) {
    setAddingId(med.id)
    setError("")
    try {
      const res = await fetch(`/api/people/${personId}/person-medications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          medication_id: med.id,
          schedule_times: [],
          tz: getDeviceTimeZone(),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(typeof j.error === "string" ? j.error : "Could not add medication.")
        return
      }
      const created = (await res.json().catch(() => null)) as { id?: number } | null
      setAddQuery("")
      setAddOpen(false)
      setAddSuggestions([])
      await loadAll()
      if (created?.id != null && Number.isFinite(created.id)) {
        setExpandedPmIds(prev => new Set(prev).add(created.id!))
      }
    } finally {
      setAddingId(null)
    }
  }

  function togglePreset(pmId: number, hm: string) {
    const ed = editors[pmId]
    const row = rows.find(r => r.id === pmId)
    if (!ed || !row) return
    const next = new Set(ed.times)
    const nextDosages = { ...ed.slotDosages }
    if (next.has(hm)) {
      next.delete(hm)
      delete nextDosages[hm]
    } else {
      next.add(hm)
      nextDosages[hm] = defaultAmt(row)
    }
    updateEditor(pmId, { times: next, slotDosages: nextDosages })
  }

  function removeScheduledTime(pmId: number, hm: string) {
    const ed = editors[pmId]
    if (!ed) return
    const next = new Set(ed.times)
    next.delete(hm)
    const nextDosages = { ...ed.slotDosages }
    delete nextDosages[hm]
    updateEditor(pmId, { times: next, slotDosages: nextDosages })
  }

  function addCustomTime(pmId: number) {
    const ed = editors[pmId]
    const row = rows.find(r => r.id === pmId)
    if (!ed?.customTimeInput || !row) return
    const normalized = parseScheduleTimeUserInput(ed.customTimeInput)
    if (!normalized) {
      setError("Custom time must be HH:mm or HHMM (24h).")
      return
    }
    setError("")
    const next = new Set(ed.times)
    next.add(normalized)
    const nextDosages = { ...ed.slotDosages, [normalized]: defaultAmt(row) }
    updateEditor(pmId, { times: next, slotDosages: nextDosages, customTimeInput: "" })
  }

  function updateSlotDose(pmId: number, hm: string, value: string) {
    const ed = editors[pmId]
    if (!ed) return
    updateEditor(pmId, { slotDosages: { ...ed.slotDosages, [hm]: value } })
  }

  if (loading && rows.length === 0) {
    return <p className="fc-admin-note">Loading…</p>
  }

  const presetSet = new Set<string>(PRESET_TIMES)

  return (
    <>
      <p className="fc-section-copy fc-surface-copy">
        Set expected dose times and amounts for each medication on this person&apos;s profile (catalogue unit only). This
        feeds the home dashboard schedule alongside catalogue frequency rules. Choose Edit on a medication to change
        its schedule, then Save. Assign new medications from the catalogue below (the new row opens ready to edit).
        Search matches Record Medication age filtering.
      </p>

      {error ? <Banner kind="error" announced>{error}</Banner> : null}

      {!loading && visibleRows.length === 0 ? (
        <EmptyState icon={EMPTY_STATE_ICONS.noSchedules} heading="No scheduled medications yet">
          Add one from the catalogue below.
        </EmptyState>
      ) : null}

      <CardList>
        {visibleRows.map(row => {
          const ed = editors[row.id]
          if (!ed) return null
          const inactive = Number(row.is_active) !== 1
          const expanded = expandedPmIds.has(row.id)

          if (inactive) {
            return (
              <ListCard
                key={row.id}
                icon="💊"
                title={row.medication_name}
                inactive
                meta={["Inactive on this profile"]}
                trailing={<Button variant="secondary" onClick={() => handleRestore(row.id)}>Restore to active list</Button>}
              />
            )
          }

          const sortedTimes = [...ed.times].sort()
          const customs = sortedTimes.filter(t => !presetSet.has(t))
          return (
            <Fragment key={row.id}>
              <ListCard
                icon="💊"
                title={row.medication_name}
                meta={[row.dosage_unit ? `Catalogue unit: ${row.dosage_unit}` : null, summarizeScheduleRow(row, ed)]}
                trailing={
                  <EntityRowActions
                    name={row.medication_name}
                    editLabel={expanded ? "Close" : "Edit"}
                    onEdit={() => toggleExpanded(row.id)}
                    deleteLabel="Remove"
                    onDelete={() => {
                      setError("")
                      setRemovePmId(row.id)
                    }}
                  />
                }
              />
              {expanded && (
                <li>
                  <Panel>
                    <FieldGroup label="Times of day" hint="Tap times to add or remove them, or enter your own below.">
                      <div className="fc-chip-set__chips">
                        {[...PRESET_TIMES, ...customs].map(t => (
                          <Chip key={t} kind="toggle" pressed={ed.times.has(t)} onPressedChange={() => togglePreset(row.id, t)}>
                            {t}
                          </Chip>
                        ))}
                      </div>
                    </FieldGroup>
                    <FormField label="Add a custom time" hint="HH:mm or four digits, for example 0830 (24 hour).">
                      <FieldRow>
                        <Input
                          type="text"
                          inputMode="numeric"
                          maxLength={5}
                          placeholder="e.g. 08:30"
                          value={ed.customTimeInput}
                          onChange={e => updateEditor(row.id, { customTimeInput: e.target.value })}
                        />
                        <Button variant="secondary" onClick={() => addCustomTime(row.id)}>Add time</Button>
                      </FieldRow>
                    </FormField>

                    {sortedTimes.length > 0 && (
                      <FieldGroup label="Dose amount per time" hint={row.dosage_unit ? `In ${row.dosage_unit}.` : undefined}>
                        {sortedTimes.map(t => (
                          <FormField key={t} label={`Dose at ${t}`}>
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              value={ed.slotDosages[t] ?? ""}
                              onChange={e => updateSlotDose(row.id, t, e.target.value)}
                            />
                          </FormField>
                        ))}
                      </FieldGroup>
                    )}

                    <FormField
                      label="Frequency"
                      hint={ed.freq.kind === "daily"
                        ? "Add as many times above as this needs — once, twice, three times a day — and the summary updates to match."
                        : undefined}
                    >
                      <Select
                        value={ed.freq.kind}
                        onChange={e => {
                          const kind = e.target.value as MedScheduleFreq["kind"]
                          let next: MedScheduleFreq
                          if (kind === "daily") next = { kind: "daily" }
                          else if (kind === "every_n_days") next = { kind: "every_n_days", n: ed.freq.kind === "every_n_days" ? ed.freq.n : 2 }
                          else next = { kind: "weekly", weekdays: ed.freq.kind === "weekly" ? ed.freq.weekdays : [1, 2, 3, 4, 5] }
                          updateEditor(row.id, { freq: next })
                        }}
                      >
                        <option value="daily">Daily</option>
                        <option value="every_n_days">Every N days</option>
                        <option value="weekly">Weekly</option>
                      </Select>
                    </FormField>
                    {ed.freq.kind === "every_n_days" && (
                      <FormField label="Every (days)">
                        <Input
                          type="number"
                          min={2}
                          step={1}
                          value={ed.freq.n}
                          onChange={e =>
                            updateEditor(row.id, { freq: { kind: "every_n_days", n: Math.max(2, parseInt(e.target.value, 10) || 2) } })
                          }
                        />
                      </FormField>
                    )}
                    {ed.freq.kind === "weekly" && (
                      <FieldGroup label="Weekdays">
                        <div className="fc-chip-set__chips">
                          {WEEKDAY_LABELS.map((label, d) => {
                            const pressed = ed.freq.kind === "weekly" && ed.freq.weekdays.includes(d)
                            return (
                              <Chip
                                key={label}
                                kind="toggle"
                                pressed={pressed}
                                onPressedChange={() => {
                                  if (ed.freq.kind !== "weekly") return
                                  const next = ed.freq.weekdays.includes(d)
                                    ? ed.freq.weekdays.filter(x => x !== d)
                                    : [...ed.freq.weekdays, d].sort((a, b) => a - b)
                                  updateEditor(row.id, { freq: { kind: "weekly", weekdays: next } })
                                }}
                              >
                                {label}
                              </Chip>
                            )
                          })}
                        </div>
                      </FieldGroup>
                    )}
                    <FormField label="Schedule start date">
                      <Input type="date" value={ed.startDate} onChange={e => updateEditor(row.id, { startDate: e.target.value })} />
                      <DateEcho date={ed.startDate} />
                    </FormField>
                    <FormField label="Schedule end date" optional>
                      <Input type="date" value={ed.endDate} onChange={e => updateEditor(row.id, { endDate: e.target.value })} />
                      <DateEcho date={ed.endDate} />
                    </FormField>

                    <div className="fc-actions-end">
                      <Button onClick={() => handleSave(row.id)} pending={savingPmId === row.id}>Save</Button>
                    </div>
                    <DoseExpectationsPanel
                      personId={personId}
                      personMedicationId={row.id}
                      scheduleTimesJson={row.schedule_times}
                    />
                  </Panel>
                </li>
              )}
            </Fragment>
          )
        })}
      </CardList>

      <Panel>
        <FormField
          label="Add medication"
          hint="Assign a catalogue medication. The new row opens ready to set times and save."
        >
          <div
            className="fc-suggest-wrap"
            onBlur={e => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setAddOpen(false)
            }}
          >
            <Input
              type="text"
              value={addQuery}
              autoComplete="off"
              placeholder="e.g. Paracetamol"
              onChange={e => {
                setAddQuery(e.target.value)
                setAddOpen(true)
              }}
              onFocus={() => addQuery.trim().length > 0 && setAddOpen(true)}
            />
            {addOpen && addSuggestions.length > 0 && (
              <SuggestionList
                items={addSuggestions
                  .filter(m => !scheduledMedIds.has(m.id))
                  .map(m => ({
                    key: m.id,
                    onSelect: () => { if (addingId !== m.id) void handleAddMedication(m) },
                    label: (
                      <>
                        <span className="fc-suggest__name">{m.name}</span>
                        <span className="fc-suggest__detail">{m.dosage_unit}</span>
                        {addingId === m.id && <span className="fc-suggest__detail">Saving…</span>}
                      </>
                    ),
                  }))}
              />
            )}
          </div>
        </FormField>
      </Panel>

      {removePmId != null && (
        <ConfirmModal
          open
          title={confirmCopy.removeMedicationFromPersonSchedule.title}
          message={confirmCopy.removeMedicationFromPersonSchedule.message}
          variant={confirmCopy.removeMedicationFromPersonSchedule.variant}
          confirmLabel={confirmCopy.removeMedicationFromPersonSchedule.confirmLabel}
          onCancel={() => setRemovePmId(null)}
          onConfirm={confirmRemoveFromSchedule}
        />
      )}
    </>
  )
}
