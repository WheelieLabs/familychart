// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { PersonHeader } from "@/components/AppHeader"
import { FcTabBar, type FcTabItem } from "@/components/FcTabBar"
import MedicationSchedulesContent from "@/components/MedicationSchedulesContent"
import ObservationRemindersContent from "@/components/ObservationRemindersContent"
import ConfirmModal from "@/components/ConfirmModal"
import { EntityRowEditButton, EntityRowDeleteButton } from "@/components/EntityRowActions"
import { formatHydration } from "@/lib/format"
import type { MeasurementSystem } from "@/lib/settings/registry"
import { defaultUnitForObservationType } from "@/lib/observation/observation-types"
import {
  roundDisplayObservationValue,
  toDisplayObservation,
} from "@/lib/observation/observation-unit-conversion"
import type { ObservationGoal, ObservationTypeConfig } from "@/lib/domain-types"
import { mainContentTargetProps } from "@/lib/a11y"

type SchedulesTab = "medications" | "observations" | "goals"

const TABS: readonly FcTabItem<SchedulesTab>[] = [
  { value: "medications", label: "Medications" },
  { value: "observations", label: "Observations" },
  { value: "goals", label: "Goals" },
]

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

interface ObsSummaryMin {
  observation_type: string
}

interface GoalRow {
  observationType: string
  goalType: "daily_min" | "range" | "trend"
  goal: ObservationGoal | null
}

function goalDisplayText(goal: ObservationGoal, measurementSystem: MeasurementSystem): string {
  switch (goal.goal_type) {
    case "daily_min":
      return `At least ${formatHydration(goal.target_value)} per day`
    case "range": {
      const min = toDisplayObservation(goal.target_value, goal.unit, goal.observation_type, measurementSystem)
      const maxRaw = goal.target_max ?? goal.target_value
      const max = toDisplayObservation(maxRaw, goal.unit, goal.observation_type, measurementSystem)
      return `Between ${roundDisplayObservationValue(min.value, min.unit)} and ${roundDisplayObservationValue(max.value, max.unit)} ${min.unit}`
    }
    case "trend": {
      const shown = toDisplayObservation(goal.target_value, goal.unit, goal.observation_type, measurementSystem)
      let text = `Reach ${roundDisplayObservationValue(shown.value, shown.unit)} ${shown.unit}`
      if (goal.target_date) text += ` by ${fmtDate(goal.target_date)}`
      return text
    }
    default: {
      const shown = toDisplayObservation(goal.target_value, goal.unit, goal.observation_type, measurementSystem)
      return `${roundDisplayObservationValue(shown.value, shown.unit)} ${shown.unit}`
    }
  }
}

interface GoalFormState {
  observationType: string
  goalType: "daily_min" | "range" | "trend"
  amountMl: string
  amountUnit: "mL" | "L"
  rangeMin: string
  rangeMax: string
  trendTarget: string
  trendDate: string
}

function emptyForm(observationType: string, goalType: "daily_min" | "range" | "trend"): GoalFormState {
  return { observationType, goalType, amountMl: "", amountUnit: "mL", rangeMin: "", rangeMax: "", trendTarget: "", trendDate: "" }
}

interface Props {
  personId: number
  name: string
  photoUrl: string | null
  color: string
  canWrite: boolean
  showPacingProfileNote?: boolean
}

export default function SchedulesGoalsClient({
  personId,
  name,
  photoUrl,
  color,
  canWrite,
  showPacingProfileNote = false,
}: Props) {
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<SchedulesTab>("medications")

  useEffect(() => {
    const t = searchParams.get("tab")
    if (t === "medications" || t === "observations" || t === "goals") {
      setTab(t)
    }
  }, [searchParams])

  return (
    <>
      <PersonHeader name={name} photoUrl={photoUrl} color={color} backHref={`/${personId}`} />
      <FcTabBar tabs={TABS} active={tab} onSelect={setTab} />
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {tab === "medications" && <MedicationSchedulesContent personId={String(personId)} />}
        {tab === "observations" && <ObservationRemindersContent personId={String(personId)} />}
        {tab === "goals" && (
          <GoalsTab
            personId={personId}
            name={name}
            canWrite={canWrite}
            showPacingProfileNote={showPacingProfileNote}
          />
        )}
      </div>
    </>
  )
}

function GoalsTab({
  personId,
  name,
  canWrite,
  showPacingProfileNote = false,
}: {
  personId: number
  name: string
  canWrite: boolean
  showPacingProfileNote?: boolean
}) {
  const [configs, setConfigs] = useState<ObservationTypeConfig[]>([])
  const [obsSummaries, setObsSummaries] = useState<ObsSummaryMin[]>([])
  const [goals, setGoals] = useState<ObservationGoal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  const [editForm, setEditForm] = useState<GoalFormState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ observationType: string; goalType: string; label: string } | null>(null)

  const [latestObs, setLatestObs] = useState<Record<string, { value: number; unit: string }>>({})
  const [measurementSystem, setMeasurementSystem] = useState<MeasurementSystem>("metric")

  const load = async () => {
    setLoading(true)
    setError("")
    try {
      const [cfgRes, summRes, goalsRes, meRes] = await Promise.all([
        fetch("/api/observation-type-config"),
        fetch(`/api/observations?summary=true&person_id=${personId}`),
        fetch(`/api/observation-goals?person_id=${personId}`),
        fetch("/api/me"),
      ])
      if (meRes.ok) {
        const me = await meRes.json() as { measurementSystem?: MeasurementSystem }
        if (me.measurementSystem === "metric" || me.measurementSystem === "imperial") {
          setMeasurementSystem(me.measurementSystem)
        }
      }
      const cfgs: ObservationTypeConfig[] = cfgRes.ok ? await cfgRes.json() : []
      const summs: ObsSummaryMin[] = summRes.ok ? await summRes.json() : []
      const gs: ObservationGoal[] = goalsRes.ok ? await goalsRes.json() : []
      setConfigs(cfgs)
      setObsSummaries(summs)
      setGoals(gs)

      // Fetch latest observations for trend directional indicator
      const trendTypes = cfgs
        .filter(c => c.typical_unit && summs.some(s => s.observation_type === c.observation_type))
        .map(c => c.observation_type)
        .filter(t => t !== "Blood Pressure")
      if (trendTypes.length > 0) {
        const results = await Promise.allSettled(
          trendTypes.map(t =>
            fetch(`/api/observations?person_id=${personId}&type=${encodeURIComponent(t)}&limit=1`)
              .then(r => r.json())
              .then((rows: Array<{ value: number; unit: string }>) =>
                rows.length > 0 ? { type: t, value: rows[0].value, unit: rows[0].unit } : null
              )
          )
        )
        const map: Record<string, { value: number; unit: string }> = {}
        for (const r of results) {
          if (r.status === "fulfilled" && r.value) {
            map[r.value.type] = { value: r.value.value, unit: r.value.unit }
          }
        }
        setLatestObs(map)
      }
    } catch {
      setError("Failed to load goals.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId])

  // Eligible types to display
  const eligibleTypes = useMemo(() => {
    const summaryTypes = new Set(obsSummaries.map(s => s.observation_type))
    return configs
      .filter(cfg => {
        if (cfg.is_active === 0) return false
        if (cfg.observation_type === "Hydration") return true
        return cfg.typical_unit != null && summaryTypes.has(cfg.observation_type)
      })
      .sort((a, b) => a.sort_order - b.sort_order)
  }, [configs, obsSummaries])

  // Build goal rows: (observationType, goalType) combinations to display
  const goalRows = useMemo((): GoalRow[] => {
    const rows: GoalRow[] = []
    for (const cfg of eligibleTypes) {
      const t = cfg.observation_type
      if (t === "Hydration") {
        const g = goals.find(g => g.observation_type === t && g.goal_type === "daily_min") ?? null
        rows.push({ observationType: t, goalType: "daily_min", goal: g })
      } else if (t === "Weight") {
        const rangeG = goals.find(g => g.observation_type === t && g.goal_type === "range") ?? null
        const trendG = goals.find(g => g.observation_type === t && g.goal_type === "trend") ?? null
        rows.push({ observationType: t, goalType: "range", goal: rangeG })
        rows.push({ observationType: t, goalType: "trend", goal: trendG })
      } else {
        const g = goals.find(g => g.observation_type === t && g.goal_type === "range") ?? null
        rows.push({ observationType: t, goalType: "range", goal: g })
      }
    }
    return rows
  }, [eligibleTypes, goals])

  async function handleSave() {
    if (!editForm) return
    setSaving(true)
    setError("")
    try {
      let targetValue: number
      let targetMax: number | null = null
      let unit: string
      let targetDate: string | null = null

      if (editForm.goalType === "daily_min") {
        const raw = parseFloat(editForm.amountMl)
        if (!Number.isFinite(raw) || raw <= 0) {
          setError("Enter a positive amount.")
          return
        }
        targetValue = editForm.amountUnit === "L" ? raw * 1000 : raw
        unit = "mL"
      } else if (editForm.goalType === "range") {
        const mn = parseFloat(editForm.rangeMin)
        const mx = parseFloat(editForm.rangeMax)
        if (!Number.isFinite(mn) || !Number.isFinite(mx) || mn >= mx) {
          setError("Enter a valid minimum and maximum (min must be less than max).")
          return
        }
        targetValue = mn
        targetMax = mx
        unit = defaultUnitForObservationType(editForm.observationType, measurementSystem)
          || configs.find(c => c.observation_type === editForm.observationType)?.typical_unit
          || ""
      } else {
        const tv = parseFloat(editForm.trendTarget)
        if (!Number.isFinite(tv) || tv <= 0) {
          setError("Enter a valid target value.")
          return
        }
        targetValue = tv
        unit = defaultUnitForObservationType(editForm.observationType, measurementSystem)
          || configs.find(c => c.observation_type === editForm.observationType)?.typical_unit
          || ""
        targetDate = editForm.trendDate || null
      }

      const res = await fetch("/api/observation-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person_id: personId,
          observation_type: editForm.observationType,
          goal_type: editForm.goalType,
          target_value: targetValue,
          target_max: targetMax,
          unit,
          target_date: targetDate,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(typeof j.error === "string" ? j.error : "Could not save goal.")
        return
      }
      setEditForm(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setSaving(true)
    try {
      await fetch(
        `/api/observation-goals?person_id=${personId}&observation_type=${encodeURIComponent(deleteTarget.observationType)}&goal_type=${encodeURIComponent(deleteTarget.goalType)}`,
        { method: "DELETE" }
      )
      setDeleteTarget(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  function startEdit(row: GoalRow) {
    const form = emptyForm(row.observationType, row.goalType)
    if (row.goal) {
      if (row.goalType === "daily_min") {
        form.amountMl = String(row.goal.target_value)
        form.amountUnit = "mL"
      } else if (row.goalType === "range") {
        form.rangeMin = String(row.goal.target_value)
        form.rangeMax = String(row.goal.target_max ?? "")
      } else {
        form.trendTarget = String(row.goal.target_value)
        form.trendDate = row.goal.target_date ?? ""
      }
    }
    setEditForm(form)
  }

  const cfg = (type: string) => configs.find(c => c.observation_type === type)

  if (loading) {
    return (
      <div className="flex-1 bg-fc-blue flex items-center justify-center">
        <div className="text-white text-lg">Loading…</div>
      </div>
    )
  }

  if (eligibleTypes.length === 0) {
    return (
      <main {...mainContentTargetProps} className="flex-1 bg-fc-blue overflow-y-auto fc-scroll">
        <div className="bg-fc-panel m-3 rounded-xl p-4 flex flex-col gap-4">
          <p className="text-sm text-gray-600">
            No goal-eligible observation types found. Record at least one observation to see goal options here. Hydration goals are always available.
          </p>
        </div>
      </main>
    )
  }

  return (
    <>
      <main {...mainContentTargetProps} className="flex-1 bg-fc-blue overflow-y-auto fc-scroll">
        <div className="bg-fc-panel m-3 rounded-xl p-4 flex flex-col gap-4">
          <p className="text-sm text-gray-600 leading-relaxed">
            Set health goals for {name}. Goals appear as reference lines on history charts.
          </p>

          {error && <p className="text-red-600 text-sm font-medium">{error}</p>}

          {goalRows.map((row, i) => {
            const typeLabel =
              row.goalType === "daily_min" ? row.observationType
              : row.goalType === "range" ? `${row.observationType} — Range`
              : `${row.observationType} — Target`

            const isEditing =
              editForm !== null &&
              editForm.observationType === row.observationType &&
              editForm.goalType === row.goalType

            const typeCfg = cfg(row.observationType)
            const unit =
              defaultUnitForObservationType(row.observationType, measurementSystem)
              || typeCfg?.typical_unit
              || ""

            const latestVal = latestObs[row.observationType]
            const trendDirectional =
              row.goalType === "trend" && editForm && isEditing && latestVal
                ? parseFloat(editForm.trendTarget) < latestVal.value
                  ? "Aiming to lose"
                  : parseFloat(editForm.trendTarget) > latestVal.value
                    ? "Aiming to gain"
                    : "Maintaining"
                : null

            return (
              <div
                key={`${row.observationType}-${row.goalType}`}
                className={`flex flex-col gap-3 ${i > 0 ? "pt-4 border-t border-gray-300" : ""}`}
              >
                <div className="flex flex-wrap items-center gap-2 min-h-[2.5rem]">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-gray-800 text-sm leading-tight">{typeLabel}</div>
                    {row.goal && !isEditing && (
                      <div className="text-gray-600 text-xs mt-0.5">{goalDisplayText(row.goal, measurementSystem)}</div>
                    )}
                    {showPacingProfileNote &&
                      row.observationType === "Hydration" &&
                      row.goalType === "daily_min" &&
                      row.goal &&
                      !isEditing && (
                        <p className="text-xs text-gray-600 mt-1">
                          Pacing reminders are configurable in{" "}
                          <Link href="/profile" className="text-fc-blue underline font-medium">
                            Profile → Settings
                          </Link>
                          .
                        </p>
                      )}
                    {!row.goal && !isEditing && (
                      <div className="text-gray-500 text-xs mt-0.5">No goal set</div>
                    )}
                  </div>
                  {canWrite && !isEditing && (
                    <div className="flex items-center gap-2 shrink-0">
                      {row.goal ? (
                        <>
                          <EntityRowEditButton onClick={() => startEdit(row)}>Edit</EntityRowEditButton>
                          <EntityRowDeleteButton
                            onClick={() => setDeleteTarget({
                              observationType: row.observationType,
                              goalType: row.goalType,
                              label: typeLabel,
                            })}
                          >
                            Delete
                          </EntityRowDeleteButton>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-bold text-gray-800
                                     hover:bg-gray-50 transition-colors"
                        >
                          + Add
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {isEditing && editForm && (
                  <div className="flex flex-col gap-3 bg-white/60 rounded-xl p-3 border border-gray-200">
                    {row.goalType === "daily_min" && (
                      <div className="flex flex-col gap-2">
                        <label className="font-bold text-gray-800 text-sm">Daily hydration goal</label>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            step="1"
                            min="0"
                            placeholder="e.g. 2000"
                            value={editForm.amountMl}
                            onChange={e => setEditForm(f => f ? { ...f, amountMl: e.target.value } : f)}
                            className="w-28 bg-white border border-gray-300 rounded px-3 py-2 text-gray-800 text-sm"
                          />
                          <select
                            value={editForm.amountUnit}
                            onChange={e => setEditForm(f => f ? { ...f, amountUnit: e.target.value as "mL" | "L" } : f)}
                            className="bg-white border border-gray-300 rounded px-3 py-2 text-gray-800 text-sm"
                          >
                            <option value="mL">mL</option>
                            <option value="L">L</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {row.goalType === "range" && (
                      <div className="flex flex-col gap-2">
                        <label className="font-bold text-gray-800 text-sm">Target range for {row.observationType}</label>
                        <div className="flex items-center gap-2 flex-wrap">
                          <input
                            type="number"
                            step="any"
                            placeholder="Min"
                            value={editForm.rangeMin}
                            onChange={e => setEditForm(f => f ? { ...f, rangeMin: e.target.value } : f)}
                            className="w-24 bg-white border border-gray-300 rounded px-3 py-2 text-gray-800 text-sm"
                          />
                          <span className="text-gray-600 text-sm">to</span>
                          <input
                            type="number"
                            step="any"
                            placeholder="Max"
                            value={editForm.rangeMax}
                            onChange={e => setEditForm(f => f ? { ...f, rangeMax: e.target.value } : f)}
                            className="w-24 bg-white border border-gray-300 rounded px-3 py-2 text-gray-800 text-sm"
                          />
                          {unit && <span className="text-gray-600 text-sm">{unit}</span>}
                        </div>
                      </div>
                    )}

                    {row.goalType === "trend" && (
                      <div className="flex flex-col gap-2">
                        <label className="font-bold text-gray-800 text-sm">{row.observationType} goal</label>
                        <div className="flex items-center gap-2 flex-wrap">
                          <input
                            type="number"
                            step="any"
                            placeholder="Target"
                            value={editForm.trendTarget}
                            onChange={e => setEditForm(f => f ? { ...f, trendTarget: e.target.value } : f)}
                            className="w-24 bg-white border border-gray-300 rounded px-3 py-2 text-gray-800 text-sm"
                          />
                          {unit && <span className="text-gray-600 text-sm">{unit}</span>}
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-sm text-gray-700">Target date (optional)</label>
                          <input
                            type="date"
                            value={editForm.trendDate}
                            onChange={e => setEditForm(f => f ? { ...f, trendDate: e.target.value } : f)}
                            className="w-40 bg-white border border-gray-300 rounded px-3 py-2 text-gray-800 text-sm"
                          />
                        </div>
                        {trendDirectional && (
                          <p className="text-xs text-gray-600">
                            {trendDirectional} from current {latestVal!.value} {latestVal!.unit}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => { setEditForm(null); setError("") }}
                        className="text-gray-600 text-sm px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={handleSave}
                        className="bg-fc-blue text-white font-bold px-4 py-1.5 rounded-lg text-sm hover:bg-fc-blue-mid
                                   disabled:opacity-50 transition-colors"
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </main>

      {deleteTarget && (
        <ConfirmModal
          open
          variant="warning"
          title="Remove goal?"
          message={`Remove the ${deleteTarget.label} goal for ${name}? This will also remove the goal indicator from their history charts.`}
          confirmLabel="Remove"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      )}
    </>
  )
}
