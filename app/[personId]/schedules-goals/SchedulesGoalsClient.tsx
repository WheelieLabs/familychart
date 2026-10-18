// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Fragment, useEffect, useMemo, useState } from "react"
import { PersonHeader } from "@/components/AppHeader"
import { personTrail } from "@/lib/ui/breadcrumbs"
import Badge from "@/components/ui/Badge"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import { Input, Select } from "@/components/ui/controls"
import DateEcho from "@/components/ui/DateEcho"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import EntityRowActions from "@/components/ui/EntityRowActions"
import { FcTabBar, type FcTabItem } from "@/components/ui/FcTabBar"
import FormField, { FieldGroup, FieldRow } from "@/components/ui/FormField"
import ListCard, { CardList } from "@/components/ui/ListCard"
import PageContainer from "@/components/ui/PageContainer"
import Panel from "@/components/ui/Panel"
import MedicationSchedulesContent from "@/components/MedicationSchedulesContent"
import ObservationRemindersContent from "@/components/ObservationRemindersContent"
import ConfirmModal from "@/components/ConfirmModal"
import { formatDate } from "@/lib/date-format"
import { formatHydration } from "@/lib/format"
import type { MeasurementSystem } from "@/lib/settings/registry"
import { defaultUnitForObservationType } from "@/lib/observation/observation-types"
import { isGoalEligible } from "@/lib/observation/goal-eligibility"
import {
  roundDisplayObservationValue,
  toDisplayObservation,
} from "@/lib/observation/observation-unit-conversion"
import type { ObservationGoal, ObservationTypeConfig } from "@/lib/domain-types"

type SchedulesTab = "medications" | "observations" | "goals"

const TABS: readonly FcTabItem<SchedulesTab>[] = [
  { value: "medications", label: "Medications" },
  { value: "observations", label: "Observations" },
  { value: "goals", label: "Goals" },
]

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
      if (goal.target_date) text += ` by ${formatDate(goal.target_date)}`
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
    <PageContainer
      header={<PersonHeader name={name} photoUrl={photoUrl} color={color} />}
      trail={personTrail(personId, name, { label: "Schedules & Goals" })}
      tabs={<FcTabBar tabs={TABS} active={tab} onSelect={setTab} />}
    >
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
    </PageContainer>
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when personId changes only
  }, [personId])

  // Eligible types to display
  const eligibleTypes = useMemo(() => {
    const summaryTypes = new Set(obsSummaries.map(s => s.observation_type))
    return configs
      .filter(cfg => {
        if (cfg.is_active === 0) return false
        if (!isGoalEligible(cfg.observation_type)) return false
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
      } else if (isGoalEligible(t, "range")) {
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
    return <p className="fc-admin-note">Loading…</p>
  }

  if (eligibleTypes.length === 0) {
    return (
      <EmptyState icon={EMPTY_STATE_ICONS.noRecords} heading="No goals to set yet">
        Record an observation to see goal options. Hydration goals are always available.
      </EmptyState>
    )
  }

  return (
    <>
      <p className="fc-section-copy fc-surface-copy">
        Set health goals for {name}. Goals appear as reference lines on history charts.
      </p>

      {error && <Banner kind="error" announced>{error}</Banner>}

      <CardList>
        {goalRows.map(row => {
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
            <Fragment key={`${row.observationType}-${row.goalType}`}>
              <ListCard
                icon="🎯"
                title={typeLabel}
                meta={[row.goal ? goalDisplayText(row.goal, measurementSystem) : null]}
                extras={
                  <>
                    {!row.goal && <Badge tone="neutral">No goal set</Badge>}
                    {showPacingProfileNote &&
                      row.observationType === "Hydration" &&
                      row.goalType === "daily_min" &&
                      row.goal && (
                        <span>
                          Pacing reminders are configurable in{" "}
                          <Link href="/profile" className="fc-card__link">Profile › Settings</Link>.
                        </span>
                      )}
                  </>
                }
                trailing={
                  canWrite && !isEditing
                    ? row.goal
                      ? (
                        <EntityRowActions
                          name={typeLabel}
                          onEdit={() => startEdit(row)}
                          deleteLabel="Remove"
                          onDelete={() => setDeleteTarget({
                            observationType: row.observationType,
                            goalType: row.goalType,
                            label: typeLabel,
                          })}
                        />
                      )
                      : <Button variant="secondary" aria-label={`Add goal for ${typeLabel}`} onClick={() => startEdit(row)}>+ Add</Button>
                    : undefined
                }
              />

              {isEditing && editForm && (
                <li>
                  <Panel>
                    {row.goalType === "daily_min" && (
                      <FormField label="Daily hydration goal">
                        <FieldRow>
                          <Input
                            type="number"
                            step="1"
                            min="0"
                            placeholder="e.g. 2000"
                            value={editForm.amountMl}
                            onChange={e => setEditForm(f => f ? { ...f, amountMl: e.target.value } : f)}
                          />
                          <Select
                            aria-label="Unit"
                            value={editForm.amountUnit}
                            onChange={e => setEditForm(f => f ? { ...f, amountUnit: e.target.value as "mL" | "L" } : f)}
                          >
                            <option value="mL">mL</option>
                            <option value="L">L</option>
                          </Select>
                        </FieldRow>
                      </FormField>
                    )}

                    {row.goalType === "range" && (
                      <FieldGroup label={`Target range for ${row.observationType}`} hint={unit ? `In ${unit}.` : undefined}>
                        <div className="fc-form-pair">
                          <FormField label="Minimum">
                            <Input
                              type="number"
                              step="any"
                              value={editForm.rangeMin}
                              onChange={e => setEditForm(f => f ? { ...f, rangeMin: e.target.value } : f)}
                            />
                          </FormField>
                          <FormField label="Maximum">
                            <Input
                              type="number"
                              step="any"
                              value={editForm.rangeMax}
                              onChange={e => setEditForm(f => f ? { ...f, rangeMax: e.target.value } : f)}
                            />
                          </FormField>
                        </div>
                      </FieldGroup>
                    )}

                    {row.goalType === "trend" && (
                      <>
                        <FormField
                          label={`${row.observationType} goal`}
                          hint={[
                            unit ? `In ${unit}.` : "",
                            trendDirectional ? `${trendDirectional} from current ${latestVal!.value} ${latestVal!.unit}.` : "",
                          ].filter(Boolean).join(" ") || undefined}
                        >
                          <Input
                            type="number"
                            step="any"
                            value={editForm.trendTarget}
                            onChange={e => setEditForm(f => f ? { ...f, trendTarget: e.target.value } : f)}
                          />
                        </FormField>
                        <FormField label="Target date" optional>
                          <Input
                            type="date"
                            value={editForm.trendDate}
                            onChange={e => setEditForm(f => f ? { ...f, trendDate: e.target.value } : f)}
                          />
                          <DateEcho date={editForm.trendDate} />
                        </FormField>
                      </>
                    )}

                    <div className="fc-form-actions">
                      <Button variant="secondary" onClick={() => { setEditForm(null); setError("") }}>Cancel</Button>
                      <Button onClick={handleSave} pending={saving}>Save</Button>
                    </div>
                  </Panel>
                </li>
              )}
            </Fragment>
          )
        })}
      </CardList>

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
