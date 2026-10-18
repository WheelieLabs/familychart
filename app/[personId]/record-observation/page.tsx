// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useState, useEffect, useMemo, useId, useRef } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import CollapsibleNotes from "@/components/CollapsibleNotes"
import RecordDateTime from "@/components/RecordDateTime"
import RecordShell, { RecordLoading } from "@/components/RecordShell"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import { ChipGroup } from "@/components/ui/Chip"
import { Input, Select } from "@/components/ui/controls"
import FormField, { FieldGroup, FieldRow } from "@/components/ui/FormField"
import { formatDateTime } from "@/lib/date-format"
import { isPairedObservationType, stepForObservationType, unitOptionsForObservationType, defaultUnitForObservationType } from "@/lib/observation/observation-types"
import type { ObservationTypeConfig, Person } from "@/lib/domain-types"
import type { MeasurementSystem } from "@/lib/settings/registry"
import { formatStaleThresholdHours, isStaleReading } from "@/lib/observation/observation-staleness"
import { instantToZonedYmdHm, localDateAndTimeToUtcIso } from "@/lib/datetime"
import { setDisplayTimeZone } from "@/lib/display-time-zone"
import { fractionalAgeYears } from "@/lib/person/person-age"
import { formatHydration } from "@/lib/format"
import {
  HYDRATION_OBSERVATION_TYPE,
  HYDRATION_PRESETS,
  matchingHydrationPreset,
  parseHydrationFavouriteAmount,
} from "@/lib/hydration/hydration-presets"
import { dashboardScheduleHeaders } from "@/lib/dashboard/dashboard-client-context"
import { reportProblem } from "@/lib/ui/form-errors"
import { setSaveFlash } from "@/lib/ui/save-flash"
import {
  applyRecordingDeviceNotification,
  recordingDeviceHeaders,
  type RecordingDeviceNotification,
} from "@/lib/push/notification-client"

const VALUE_ID = "observation-value"

type StaticRecordMode = "update" | "new"

interface LatestObservation {
  id: number
  value: number
  unit: string
  recorded_at: string
}

export default function RecordObservationPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialType = searchParams.get("type")
  // A Hydration favourite's pre-set amount (mL); the person still presses Save.
  const prefillAmount = parseHydrationFavouriteAmount(searchParams.get("amount") ?? "")
  const prefillApplied = useRef(false)
  const personId = params.personId as string

  const [person, setPerson] = useState<Person | null>(null)
  const [configs, setConfigs] = useState<ObservationTypeConfig[] | null>(null)
  const [configsErr, setConfigsErr] = useState("")

  const [recordNow, setRecordNow] = useState(true)
  const { date: todayDate, time: nowTime } = instantToZonedYmdHm(new Date())
  const [date, setDate]       = useState(todayDate)
  const [time, setTime]       = useState(nowTime)


  const [obsType, setObsType] = useState("")
  const [value, setValue]     = useState("")
  const [unit, setUnit]       = useState("")
  const [systolic, setSystolic]   = useState("")
  const [diastolic, setDiastolic] = useState("")
  const [comments, setComments]   = useState("")
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState("")
  const [fieldErr, setFieldErr]   = useState<{ id: string; message: string } | null>(null)

  const [latestObs, setLatestObs] = useState<LatestObservation | null>(null)
  const [staticMode, setStaticMode] = useState<StaticRecordMode>("update")

  const [hydrationToday, setHydrationToday] = useState<{ total_ml: number; goal_ml: number | null } | null>(null)
  const [measurementSystem, setMeasurementSystem] = useState<MeasurementSystem>("metric")
  const [instanceTimezone, setInstanceTimezone] = useState<string | null>(null)
  // Until the instance timezone arrives the date and time default to UTC, so re-seed them once it does.
  // They are only shown while "Record now" is on, so this never overwrites something the person typed.
  useEffect(() => {
    if (!instanceTimezone || !recordNow) return
    const now = instantToZonedYmdHm(new Date(), instanceTimezone)
    setDate(now.date)
    setTime(now.time)
  }, [instanceTimezone]) // eslint-disable-line react-hooks/exhaustive-deps -- seeds once per zone

  const systolicId = useId()
  const diastolicId = useId()

  const personAgeYears = useMemo(() => {
    if (!person?.date_of_birth || !instanceTimezone) return null
    const age = fractionalAgeYears(person.date_of_birth, instanceTimezone)
    return Number.isFinite(age) ? age : null
  }, [person, instanceTimezone])

  const availableConfigs = useMemo(() => {
    if (!configs) return []
    return configs.filter(cfg => {
      if (cfg.is_active === 0) return false
      if (cfg.max_age_years == null) return true
      if (personAgeYears === null) return true
      return personAgeYears <= cfg.max_age_years
    })
  }, [configs, personAgeYears])

  const currentConfig = useMemo(
    () => availableConfigs.find(c => c.observation_type === obsType) ?? availableConfigs[0],
    [availableConfigs, obsType]
  )

  const isPaired = currentConfig ? isPairedObservationType(currentConfig.observation_type) : false
  const isStatic = currentConfig ? currentConfig.is_static === 1 : false
  const isHydration = currentConfig?.observation_type === "Hydration"
  const units = currentConfig
    ? unitOptionsForObservationType(currentConfig.observation_type, currentConfig.typical_unit)
    : [""]
  const step = currentConfig ? stepForObservationType(currentConfig.observation_type) : "0.1"
  const valueLabel = isHydration ? "Custom amount" : "Value"

  useEffect(() => {
    fetch(`/api/people/${personId}`).then(r => r.json()).then(setPerson)
  }, [personId])

  useEffect(() => {
    fetch("/api/me")
      .then(r => (r.ok ? r.json() : null))
      .then((me: { measurementSystem?: MeasurementSystem; instanceTimezone?: string } | null) => {
        if (me?.measurementSystem === "metric" || me?.measurementSystem === "imperial") {
          setMeasurementSystem(me.measurementSystem)
        }
        if (typeof me?.instanceTimezone === "string" && me.instanceTimezone.trim() !== "") {
          setDisplayTimeZone(me.instanceTimezone)
          setInstanceTimezone(me.instanceTimezone)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch("/api/observation-type-config")
      .then(r => {
        if (!r.ok) throw new Error("config")
        return r.json()
      })
      .then((rows: ObservationTypeConfig[]) => {
        setConfigs(rows)
        setConfigsErr("")
        if (rows.length > 0 && !obsType) {
          const preselect =
            initialType && rows.some(r => r.observation_type === initialType)
              ? initialType
              : rows[0].observation_type
          setObsType(preselect)
        }
      })
      .catch(() => {
        setConfigs([])
        setConfigsErr("Could not load Observation Types.")
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- initial obsType only
  }, [])

  useEffect(() => {
    if (person && currentConfig && !availableConfigs.find(c => c.observation_type === obsType)) {
      setObsType(availableConfigs[0]?.observation_type ?? "")
    }
  }, [availableConfigs, currentConfig, obsType, person])

  useEffect(() => {
    if (!currentConfig) return
    const opts = unitOptionsForObservationType(
      currentConfig.observation_type,
      currentConfig.typical_unit
    )
    const localeDefault = defaultUnitForObservationType(
      currentConfig.observation_type,
      measurementSystem,
    )
    const def =
      (localeDefault && opts.includes(localeDefault)
        ? localeDefault
        : opts[0]) ?? ""
    const hydrationPrefill =
      currentConfig.observation_type === HYDRATION_OBSERVATION_TYPE && prefillAmount != null
    setUnit(hydrationPrefill ? "mL" : def)
  }, [currentConfig, measurementSystem, prefillAmount])

  useEffect(() => {
    if (prefillApplied.current || prefillAmount == null) return
    if (currentConfig?.observation_type !== HYDRATION_OBSERVATION_TYPE) return
    prefillApplied.current = true
    setValue(String(prefillAmount))
  }, [currentConfig, prefillAmount])

  useEffect(() => {
    if (!isStatic || !currentConfig) {
      setLatestObs(null)
      setStaticMode("update")
      return
    }
    fetch(
      `/api/observations?person_id=${personId}&type=${encodeURIComponent(currentConfig.observation_type)}&limit=1`
    )
      .then(r => r.json())
      .then((records: LatestObservation[]) => {
        if (records.length > 0) {
          setLatestObs(records[0])
          setStaticMode("update")
        } else {
          setLatestObs(null)
        }
      })
      .catch(() => { setLatestObs(null) })
  }, [isStatic, currentConfig?.observation_type, personId, currentConfig])

  useEffect(() => {
    if (!isHydration) { setHydrationToday(null); return }
    fetch(`/api/observations/hydration-today?person_id=${personId}`, { headers: dashboardScheduleHeaders() })
      .then(r => r.json())
      .then(setHydrationToday)
      .catch(() => {})
  }, [isHydration, personId])

  /** One validation problem: show it, mark the field, focus it and announce it. */
  function fail(message: string, fieldId: string, fieldLabel: string) {
    setFieldErr({ id: fieldId, message })
    setSaving(false)
    reportProblem(fieldId, fieldLabel)
  }

  async function handleSave() {
    setSaving(true); setError(""); setFieldErr(null)
    let savedMessage = ""
    try {
      const recordedAt = recordNow
        ? new Date().toISOString()
        : localDateAndTimeToUtcIso(date, time)

      if (!currentConfig) {
        setError("No Observation Type selected.")
        setSaving(false)
        return
      }

      if (isPaired) {
        if (!systolic || !diastolic) {
          if (!systolic) fail("Enter both the systolic and diastolic values.", systolicId, "Systolic")
          else fail("Enter both the systolic and diastolic values.", diastolicId, "Diastolic")
          return
        }
        const sessionId = crypto.randomUUID()
        const base = {
          person_id: parseInt(personId), observation_type: "Blood Pressure",
          unit: "mmHg", recorded_at: recordedAt, comments: comments || null,
          session_id: sessionId,
        }
        const results = await Promise.all([
          fetch("/api/observations", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...base, value: parseFloat(systolic), value_label: "Systolic" }),
          }),
          fetch("/api/observations", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...base, value: parseFloat(diastolic), value_label: "Diastolic" }),
          }),
        ])
        if (results.some(r => !r.ok)) {
          setError("Failed to save. Please try again.")
          setSaving(false)
          return
        }
        savedMessage = `Blood Pressure ${systolic}/${diastolic} mmHg`
      } else if (isStatic && latestObs && staticMode === "update") {
        if (!value) { fail("Enter a value.", VALUE_ID, valueLabel); return }
        const res = await fetch(`/api/observations/${latestObs.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recorded_at: recordedAt, value: parseFloat(value), unit, comments: comments || null,
          }),
        })
        if (!res.ok) {
          setError("Failed to save. Please try again.")
          setSaving(false)
          return
        }
        savedMessage = `${currentConfig.observation_type} ${value} ${unit}`
      } else {
        if (!value) { fail("Enter a value.", VALUE_ID, valueLabel); return }
        let saveValue = parseFloat(value)
        let saveUnit = unit
        if (isHydration && unit === "L") {
          saveValue = saveValue * 1000
          saveUnit = "mL"
        }
        const res = await fetch("/api/observations", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(isHydration ? await recordingDeviceHeaders() : {}) },
          body: JSON.stringify({
            person_id: parseInt(personId), observation_type: currentConfig.observation_type,
            value: saveValue, unit: saveUnit, recorded_at: recordedAt, comments: comments || null,
          }),
        })
        if (!res.ok) {
          setError("Failed to save. Please try again.")
          setSaving(false)
          return
        }
        if (isHydration) {
          // Caught up closes this device's nudge; still behind updates it quietly. Other devices get a push.
          const saved = (await res.json().catch(() => null)) as { hydrationNotification?: RecordingDeviceNotification | null } | null
          await applyRecordingDeviceNotification(saved?.hydrationNotification)
        }
        savedMessage = `${currentConfig.observation_type} ${saveValue} ${saveUnit}`
      }
      setSaveFlash(savedMessage)
      router.push(`/${personId}`)
    } catch {
      setError("Failed to save. Please try again.")
      setSaving(false)
    }
  }

  if (!person) return <RecordLoading title="Record Observation" />

  if (configs === null) return <RecordLoading title="Record Observation">Loading Observation Types…</RecordLoading>

  if (configsErr || availableConfigs.length === 0) return (
    <RecordShell title="Record Observation" person={person}>
      <Banner kind="warning">{configsErr || "No Observation Types are configured."}</Banner>
    </RecordShell>
  )

  const valueError = fieldErr?.id === VALUE_ID ? fieldErr.message : undefined

  return (
    <RecordShell title="Record Observation" person={person}>
      <div className="fc-form">
        <RecordDateTime
          recordNow={recordNow}
          onRecordNowChange={setRecordNow}
          date={date}
          onDateChange={setDate}
          time={time}
          onTimeChange={setTime}
          timeZone={instanceTimezone ?? undefined}
        />

        <FormField label="Observation type">
          <Select value={obsType} onChange={e => setObsType(e.target.value)}>
            {availableConfigs.map(c => (
              <option key={c.observation_type} value={c.observation_type}>{c.observation_type}</option>
            ))}
          </Select>
        </FormField>

        {isStatic && latestObs && (
          <>
            <Banner kind="info">
              {currentConfig.observation_type} is typically updated when it changes rather than recorded
              repeatedly. Current value: {latestObs.value} {latestObs.unit} (recorded {formatDateTime(latestObs.recorded_at)}).
            </Banner>
            <ChipGroup
              legend="Update or add"
              options={[
                { value: "update", label: "Update current value" },
                { value: "new", label: "Add as new record" },
              ]}
              value={staticMode}
              onChange={setStaticMode}
            />
          </>
        )}

        {isStatic && latestObs && currentConfig &&
          currentConfig.stale_after_hours != null &&
          currentConfig.stale_after_hours > 0 &&
          isStaleReading(latestObs.recorded_at, currentConfig.stale_after_hours) && (
          <Banner kind="warning" lead="Out of date">
            The current value is older than the suggested refresh window ({formatStaleThresholdHours(currentConfig.stale_after_hours)}).
            Recorded {formatDateTime(latestObs.recorded_at)}.
          </Banner>
        )}

        {isHydration && (
          <Banner kind="info" lead="Today">
            {hydrationToday === null
              ? "Loading today's total…"
              : hydrationToday.total_ml === 0 && hydrationToday.goal_ml === null
                ? "Nothing recorded yet today."
                : hydrationToday.goal_ml !== null
                  ? `${formatHydration(hydrationToday.total_ml)} of ${formatHydration(hydrationToday.goal_ml)} goal.`
                  : `${formatHydration(hydrationToday.total_ml)} recorded.`}
          </Banner>
        )}

        {isPaired ? (
          <FieldGroup label="Blood pressure" hint="In mmHg">
            <div className="fc-form-pair">
              <FormField
                id={systolicId}
                label="Systolic"
                error={fieldErr?.id === systolicId ? fieldErr.message : undefined}
              >
                <Input type="number" value={systolic} onChange={e => setSystolic(e.target.value)}
                  step="1" min="0" placeholder="e.g. 120" />
              </FormField>
              <FormField
                id={diastolicId}
                label="Diastolic"
                error={fieldErr?.id === diastolicId ? fieldErr.message : undefined}
              >
                <Input type="number" value={diastolic} onChange={e => setDiastolic(e.target.value)}
                  step="1" min="0" placeholder="e.g. 80" />
              </FormField>
            </div>
          </FieldGroup>
        ) : isHydration ? (
          <>
            <ChipGroup
              legend="Amount"
              options={HYDRATION_PRESETS.map(p => ({ value: String(p.ml), label: `${p.ml} mL · ${p.label}` }))}
              value={String(matchingHydrationPreset(value, unit)?.ml ?? "")}
              onChange={ml => { setValue(ml); setUnit("mL") }}
            />
            <FormField id={VALUE_ID} label="Custom amount" error={valueError}>
              <FieldRow>
                <Input type="number" value={value} onChange={e => setValue(e.target.value)}
                  step="1" min="0" placeholder="e.g. 250" />
                <Select aria-label="Unit" value={unit} onChange={e => setUnit(e.target.value)}>
                  <option value="mL">mL</option>
                  <option value="L">L</option>
                </Select>
              </FieldRow>
            </FormField>
          </>
        ) : (
          <FormField id={VALUE_ID} label="Value" error={valueError}>
            <FieldRow>
              <Input type="number" value={value} onChange={e => setValue(e.target.value)}
                step={step} min="0" placeholder="0" />
              <Select aria-label="Unit" value={unit} onChange={e => setUnit(e.target.value)}>
                {units.map(u => <option key={u} value={u}>{u}</option>)}
              </Select>
            </FieldRow>
          </FormField>
        )}

        <CollapsibleNotes noun="comment" value={comments} onChange={setComments} />

        {error && <Banner kind="error">{error}</Banner>}

        <div className="fc-actions-end">
          <Button onClick={handleSave} pending={saving}>Save</Button>
        </div>
      </div>
    </RecordShell>
  )
}
