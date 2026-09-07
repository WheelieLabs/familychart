// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import ConfirmModal, { confirmCopy } from "@/components/ConfirmModal"
import { PanelOutlineRemoveButton, ScheduleChipDismissButton } from "@/components/EntityRowActions"
import { mainContentTargetProps } from "@/lib/a11y"
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

function summarizeFreq(freq: MedScheduleFreq): string {
  switch (freq.kind) {
    case "daily":
      return "Daily"
    case "twice_daily":
      return "Twice daily"
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
  if (ta.length === 0) return `No scheduled times · ${summarizeFreq(ed.freq)}`
  const doseParts = ta.map(t => {
    const raw = ed.slotDosages[t]?.trim() ?? ""
    const amt = raw !== "" && Number.isFinite(parseFloat(raw)) ? raw : "?"
    return `${t} (${amt}${unit})`
  })
  const datePart = ed.startDate ? ` · from ${ed.startDate}` : ""
  return doseParts.join(", ") + " · " + summarizeFreq(ed.freq) + datePart
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

      const clientTz = Intl.DateTimeFormat().resolvedOptions().timeZone
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
    if (ed.freq.kind === "twice_daily" && timeArr.length !== 2) {
      setError(`Twice daily: pick exactly two times (${row.medication_name}).`)
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
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
      body: JSON.stringify({ is_active: true, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
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
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
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

  const fieldSelect =
    "w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-800 min-w-0"
  const fieldInput =
    "bg-white border border-gray-300 rounded px-3 py-2 text-gray-800"

  if (loading && rows.length === 0) {
    return (
      <div className="flex-1 bg-fc-blue flex items-center justify-center">
        <div className="text-white text-lg">Loading…</div>
      </div>
    )
  }

  return (
    <>
      <main {...mainContentTargetProps} className="flex-1 min-h-0 bg-fc-blue overflow-y-auto fc-scroll">
        <div className="bg-fc-panel m-3 rounded-xl p-4 flex flex-col gap-4">
          <p className="text-sm text-gray-600 leading-relaxed">
            Set expected dose times and amounts for each medication on this person&apos;s profile (catalogue unit only). This
            feeds the home dashboard schedule alongside catalogue frequency rules. Expand a row to edit; tap{" "}
            <strong className="text-gray-800">Save</strong> to store and collapse. Assign new medications from the
            catalogue below (opens expanded). Search matches Record Medication age filtering.
          </p>

          {error ? <p className="text-red-600 text-sm font-medium">{error}</p> : null}

          {!loading && visibleRows.length === 0 ? (
            <p className="text-gray-600 text-center py-4 text-sm">
              No scheduled medications yet. Add one from the catalogue below.
            </p>
          ) : null}

          {visibleRows.map(row => {
            const ed = editors[row.id]
            if (!ed) return null
            const inactive = Number(row.is_active) !== 1
            const expanded = expandedPmIds.has(row.id)

            if (inactive) {
              return (
                <div
                  key={row.id}
                  className="flex flex-col gap-3 pt-4 border-t border-gray-300 first:border-t-0 first:pt-0 opacity-70"
                >
                  <div className="font-bold text-gray-800 text-lg leading-tight">{row.medication_name}</div>
                  <div className="text-amber-800 text-xs font-semibold">Inactive on this profile</div>
                  <button
                    type="button"
                    onClick={() => handleRestore(row.id)}
                    className="self-start rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-800
                               hover:bg-gray-50 transition-colors"
                  >
                    Restore to active list
                  </button>
                </div>
              )
            }

            return (
              <div
                key={row.id}
                className="flex flex-col gap-3 pt-4 border-t border-gray-300 first:border-t-0 first:pt-0"
              >
                <div className="flex flex-wrap items-start gap-2">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(row.id)}
                    className="flex flex-1 min-w-0 items-start gap-2 rounded-lg text-left hover:bg-white/40 transition-colors px-1 py-0.5 -mx-1"
                  >
                    <span className="text-gray-500 text-xl leading-none shrink-0 mt-0.5 w-5">
                      {expanded ? "▼" : "›"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-gray-800 text-lg leading-tight">{row.medication_name}</div>
                      {row.dosage_unit ? (
                        <div className="text-gray-600 text-xs mt-0.5">Catalogue unit: {row.dosage_unit}</div>
                      ) : null}
                      <div className="text-gray-600 text-xs mt-1 leading-snug">{summarizeScheduleRow(row, ed)}</div>
                    </div>
                  </button>
                  <PanelOutlineRemoveButton
                    onClick={() => {
                      setError("")
                      setRemovePmId(row.id)
                    }}
                  >
                    Remove from list
                  </PanelOutlineRemoveButton>
                </div>

                {expanded && (
                  <>
                    <div>
                      <label className="font-bold text-gray-800 block mb-1">Times of day</label>
                      <div className="flex flex-wrap gap-2">
                        {PRESET_TIMES.map(t => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => togglePreset(row.id, t)}
                            className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                              ed.times.has(t)
                                ? "bg-fc-blue text-white"
                                : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                      {(() => {
                        const presetSet = new Set<string>(PRESET_TIMES)
                        const customs = [...ed.times].filter(t => !presetSet.has(t)).sort()
                        if (customs.length === 0) return null
                        return (
                          <div className="mt-3">
                            <div className="text-xs font-semibold text-gray-700 mb-1.5">Custom times</div>
                            <div className="flex flex-wrap gap-2">
                              {customs.map(t => (
                                <span
                                  key={t}
                                  className="inline-flex items-center gap-1 rounded-lg bg-fc-blue text-white pl-3 pr-1 py-1.5 text-sm font-semibold"
                                >
                                  {t}
                                  <ScheduleChipDismissButton
                                    aria-label={`Remove ${t}`}
                                    onClick={() => removeScheduledTime(row.id, t)}
                                  />
                                </span>
                              ))}
                            </div>
                          </div>
                        )
                      })()}
                      <div className="flex gap-2 mt-3 flex-wrap items-end">
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={5}
                          placeholder="HH:mm or HHMM"
                          value={ed.customTimeInput}
                          onChange={e => updateEditor(row.id, { customTimeInput: e.target.value })}
                          className={`${fieldInput} text-sm w-36`}
                        />
                        <button
                          type="button"
                          onClick={() => addCustomTime(row.id)}
                          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-800
                                     hover:bg-gray-50 transition-colors"
                        >
                          Add time
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 mt-1.5">
                        Tap presets, or enter a time as HH:mm or four digits (e.g. 0830). Remove custom times with ×.
                      </p>
                    </div>

                    {[...ed.times].sort().length > 0 && (
                      <div>
                        <label className="font-bold text-gray-800 block mb-2">Dose amount per time</label>
                        <div className="flex flex-col gap-2">
                          {[...ed.times].sort().map(t => (
                            <div key={t} className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-gray-800 w-14 shrink-0">{t}</span>
                              <input
                                type="number"
                                min={0}
                                step="any"
                                value={ed.slotDosages[t] ?? ""}
                                onChange={e => updateSlotDose(row.id, t, e.target.value)}
                                className={`${fieldInput} text-sm w-24`}
                              />
                              {row.dosage_unit ? (
                                <span className="text-xs text-gray-600">{row.dosage_unit}</span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="font-bold text-gray-800 block mb-1">Frequency</label>
                        <select
                          value={ed.freq.kind}
                          onChange={e => {
                            const kind = e.target.value as MedScheduleFreq["kind"]
                            let next: MedScheduleFreq
                            if (kind === "daily") next = { kind: "daily" }
                            else if (kind === "twice_daily") next = { kind: "twice_daily" }
                            else if (kind === "every_n_days") next = { kind: "every_n_days", n: ed.freq.kind === "every_n_days" ? ed.freq.n : 2 }
                            else next = { kind: "weekly", weekdays: ed.freq.kind === "weekly" ? ed.freq.weekdays : [1, 2, 3, 4, 5] }
                            updateEditor(row.id, { freq: next })
                          }}
                          className={fieldSelect}
                        >
                          <option value="daily">Daily</option>
                          <option value="twice_daily">Twice daily (two times)</option>
                          <option value="every_n_days">Every N days</option>
                          <option value="weekly">Weekly</option>
                        </select>
                        {ed.freq.kind === "every_n_days" && (
                          <div className="mt-2 flex items-center gap-2">
                            <label className="text-xs text-gray-700 whitespace-nowrap">Every</label>
                            <input
                              type="number"
                              min={2}
                              step={1}
                              value={ed.freq.n}
                              onChange={e =>
                                updateEditor(row.id, { freq: { kind: "every_n_days", n: Math.max(2, parseInt(e.target.value, 10) || 2) } })
                              }
                              className={`${fieldInput} w-16 text-sm`}
                            />
                            <span className="text-xs text-gray-600">days</span>
                          </div>
                        )}
                        {ed.freq.kind === "weekly" && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {WEEKDAY_LABELS.map((label, d) => {
                              const pressed = ed.freq.kind === "weekly" && ed.freq.weekdays.includes(d)
                              return (
                                <button
                                  key={label}
                                  type="button"
                                  onClick={() => {
                                    if (ed.freq.kind !== "weekly") return
                                    const next = ed.freq.weekdays.includes(d)
                                      ? ed.freq.weekdays.filter(x => x !== d)
                                      : [...ed.freq.weekdays, d].sort((a, b) => a - b)
                                    updateEditor(row.id, { freq: { kind: "weekly", weekdays: next } })
                                  }}
                                  className={`rounded-full px-2.5 py-1 text-xs font-bold transition-colors ${
                                    pressed
                                      ? "bg-fc-blue text-white"
                                      : "border border-gray-300 bg-white text-gray-700"
                                  }`}
                                >
                                  {label}
                                </button>
                              )
                            })}
                            <span className="text-xs text-gray-500 w-full mt-1">Sun=0 … Sat=6.</span>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-3">
                        <div>
                          <label className="font-bold text-gray-800 block mb-1">Schedule start date</label>
                          <input
                            type="date"
                            value={ed.startDate}
                            onChange={e => updateEditor(row.id, { startDate: e.target.value })}
                            className={`${fieldSelect} text-sm`}
                          />
                        </div>
                        <div>
                          <label className="font-bold text-gray-800 block mb-1">Schedule end date (optional)</label>
                          <input
                            type="date"
                            value={ed.endDate}
                            onChange={e => updateEditor(row.id, { endDate: e.target.value })}
                            className={`${fieldSelect} text-sm`}
                          />
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={savingPmId === row.id}
                      onClick={() => handleSave(row.id)}
                      className="self-end bg-fc-blue text-white font-bold px-6 py-3 rounded-xl hover:bg-fc-blue-mid
                                 active:bg-fc-blue-dark disabled:opacity-50 transition-colors"
                    >
                      {savingPmId === row.id ? "Saving…" : "Save"}
                    </button>
                  </>
                )}
              </div>
            )
          })}

          <div className="border-t border-gray-300 pt-4 flex flex-col gap-3">
            <div className="font-bold text-gray-800">Add medication</div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Assign a catalogue medication. The row opens expanded so you can set times and save.
            </p>
            <input
              type="text"
              value={addQuery}
              onChange={e => {
                setAddQuery(e.target.value)
                setAddOpen(true)
              }}
              onFocus={() => addQuery.trim().length > 0 && setAddOpen(true)}
              placeholder="Type medication name…"
              className={`${fieldSelect} text-sm`}
            />
            {addOpen && addSuggestions.length > 0 && (
              <ul className="rounded-lg border border-gray-300 bg-white max-h-48 overflow-y-auto shadow-lg">
                {addSuggestions.map(m =>
                  scheduledMedIds.has(m.id) ? null : (
                    <li key={m.id}>
                      <button
                        type="button"
                        disabled={addingId === m.id}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-fc-panel text-gray-900 disabled:opacity-50"
                        onClick={() => handleAddMedication(m)}
                      >
                        <span className="font-semibold">{m.name}</span>
                        <span className="text-gray-500 text-xs ml-2">{m.dosage_unit}</span>
                        {addingId === m.id && <span className="text-xs ml-2">Saving…</span>}
                      </button>
                    </li>
                  )
                )}
              </ul>
            )}
          </div>
        </div>
      </main>

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
