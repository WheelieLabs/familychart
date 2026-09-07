// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useState, useEffect, useMemo, useId } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import { PersonHeader } from "@/components/AppHeader"
import Toggle from "@/components/Toggle"
import { isPairedObservationType, stepForObservationType, unitOptionsForObservationType, defaultUnitForObservationType } from "@/lib/observation/observation-types"
import type { ObservationTypeConfig, Person } from "@/lib/domain-types"
import type { MeasurementSystem } from "@/lib/settings/registry"
import { formatStaleThresholdHours, isStaleReading } from "@/lib/observation/observation-staleness"
import { localDateAndTimeToUtcIso, localDateToIsoYmd } from "@/lib/datetime"
import { fractionalAgeYears } from "@/lib/person/person-age"
import { formatHydration } from "@/lib/format"
import { dashboardScheduleHeaders } from "@/lib/dashboard/dashboard-client-context"
import { mainContentTargetProps } from "@/lib/a11y"

function toLocalDatetime(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return {
    date: localDateToIsoYmd(d),
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

function fmtAU(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours()
  const hour = h % 12 || 12
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${hour}:${d.getMinutes().toString().padStart(2,"0")} ${h >= 12 ? "PM" : "AM"}`
}

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
  const personId = params.personId as string

  const [person, setPerson] = useState<Person | null>(null)
  const [configs, setConfigs] = useState<ObservationTypeConfig[] | null>(null)
  const [configsErr, setConfigsErr] = useState("")

  const [recordNow, setRecordNow] = useState(true)
  const { date: todayDate, time: nowTime } = toLocalDatetime(new Date())
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

  const [latestObs, setLatestObs] = useState<LatestObservation | null>(null)
  const [staticMode, setStaticMode] = useState<StaticRecordMode>("update")

  const [hydrationToday, setHydrationToday] = useState<{ total_ml: number; goal_ml: number | null } | null>(null)
  const [measurementSystem, setMeasurementSystem] = useState<MeasurementSystem>("metric")
  const [instanceTimezone, setInstanceTimezone] = useState<string | null>(null)

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
    setUnit(def)
  }, [currentConfig, measurementSystem])

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

  async function handleSave() {
    setSaving(true); setError("")
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
          setError("Please enter both systolic and diastolic values")
          setSaving(false)
          return
        }
        const sessionId = crypto.randomUUID()
        const base = {
          person_id: parseInt(personId), observation_type: "Blood Pressure",
          unit: "mmHg", recorded_at: recordedAt, comments: comments || null,
          session_id: sessionId,
        }
        await Promise.all([
          fetch("/api/observations", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...base, value: parseFloat(systolic), value_label: "Systolic" }),
          }),
          fetch("/api/observations", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...base, value: parseFloat(diastolic), value_label: "Diastolic" }),
          }),
        ])
      } else if (isStatic && latestObs && staticMode === "update") {
        if (!value) { setError("Please enter a value"); setSaving(false); return }
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
      } else {
        if (!value) { setError("Please enter a value"); setSaving(false); return }
        let saveValue = parseFloat(value)
        let saveUnit = unit
        if (isHydration && unit === "L") {
          saveValue = saveValue * 1000
          saveUnit = "mL"
        }
        await fetch("/api/observations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            person_id: parseInt(personId), observation_type: currentConfig.observation_type,
            value: saveValue, unit: saveUnit, recorded_at: recordedAt, comments: comments || null,
          }),
        })
      }
      router.push(`/${personId}`)
    } catch {
      setError("Failed to save. Please try again.")
      setSaving(false)
    }
  }

  if (!person) return (
    <div className="flex-1 bg-fc-blue flex items-center justify-center">
      <div className="text-white text-lg">Loading…</div>
    </div>
  )

  if (configs === null) return (
    <div className="flex-1 bg-fc-blue flex items-center justify-center">
      <div className="text-white text-lg">Loading Observation Types…</div>
    </div>
  )

  if (configsErr || availableConfigs.length === 0) return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Record Observation" />
      <PersonHeader name={person.name} photoUrl={person.photo_url} color={person.color} backHref={`/${personId}`} />
      <main {...mainContentTargetProps} className="flex-1 bg-fc-blue overflow-y-auto fc-scroll flex items-center justify-center p-4">
        <p className="text-white text-center">{configsErr || "No Observation Types are configured."}</p>
      </main>
      <AppFooter />
    </div>
  )

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Record Observation" />
      <PersonHeader name={person.name} photoUrl={person.photo_url} color={person.color} backHref={`/${personId}`} />
      <main {...mainContentTargetProps} className="flex-1 bg-fc-blue overflow-y-auto fc-scroll">
        <div className="bg-fc-panel m-3 rounded-xl p-4 flex flex-col gap-4">

          <Toggle label="Record Now?" value={recordNow} onChange={setRecordNow} />

          <div className="flex items-center gap-3">
            <label className="font-bold text-gray-800 w-16 shrink-0">Date:</label>
            <input type="date" value={date} disabled={recordNow} onChange={e => setDate(e.target.value)}
              className="flex-1 bg-white border border-gray-300 rounded px-3 py-2 text-gray-700
                         disabled:bg-gray-100 disabled:text-gray-400" />
          </div>
          <div className="flex items-center gap-3">
            <label className="font-bold text-gray-800 w-16 shrink-0">Time:</label>
            <input type="time" value={time} disabled={recordNow} onChange={e => setTime(e.target.value)}
              className="flex-1 bg-white border border-gray-300 rounded px-3 py-2 text-gray-700
                         disabled:bg-gray-100 disabled:text-gray-400" />
          </div>

          <div>
            <label className="font-bold text-gray-800 block mb-1">Observation Type</label>
            <select value={obsType} onChange={e => setObsType(e.target.value)}
              className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-800">
              {availableConfigs.map(c => (
                <option key={c.observation_type} value={c.observation_type}>{c.observation_type}</option>
              ))}
            </select>
          </div>

          {isStatic && latestObs && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/90 px-3 py-3 text-sm text-gray-800">
              <p className="font-semibold text-gray-900 mb-1">ℹ️ {currentConfig.observation_type} is typically updated when it changes rather than recorded repeatedly.</p>
              <p>
                <span className="font-medium">Current value:</span>{" "}
                {latestObs.value} {latestObs.unit}{" "}
                <span className="text-gray-600">(recorded {fmtAU(latestObs.recorded_at)})</span>
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="staticMode"
                    checked={staticMode === "update"}
                    onChange={() => setStaticMode("update")}
                    className="accent-fc-blue"
                  />
                  <span>Update current value</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="staticMode"
                    checked={staticMode === "new"}
                    onChange={() => setStaticMode("new")}
                    className="accent-fc-blue"
                  />
                  <span>Add as new record</span>
                </label>
              </div>
            </div>
          )}

          {isStatic && latestObs && currentConfig &&
            currentConfig.stale_after_hours != null &&
            currentConfig.stale_after_hours > 0 &&
            isStaleReading(latestObs.recorded_at, currentConfig.stale_after_hours) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-3 text-sm text-gray-900">
              <p className="font-semibold text-amber-950 mb-1">
                🕐 Current value is older than the suggested refresh window ({formatStaleThresholdHours(currentConfig.stale_after_hours)}).
              </p>
              <p className="text-gray-700">Recorded {fmtAU(latestObs.recorded_at)}.</p>
            </div>
          )}

          {isHydration && (
            <div className="rounded-lg bg-blue-50/90 border border-blue-200 px-3 py-2 text-sm text-gray-800">
              {hydrationToday === null
                ? "Loading today's total…"
                : hydrationToday.total_ml === 0 && hydrationToday.goal_ml === null
                  ? "Nothing recorded yet today"
                  : hydrationToday.goal_ml !== null
                    ? `Today: ${formatHydration(hydrationToday.total_ml)} of ${formatHydration(hydrationToday.goal_ml)} goal`
                    : `Today: ${formatHydration(hydrationToday.total_ml)} recorded`}
            </div>
          )}

          {isPaired ? (
            <div>
              <label className="font-bold text-gray-800 block mb-2">Blood Pressure (mmHg):</label>
              <div className="flex gap-3 items-end">
                <div className="flex flex-col gap-1 flex-1">
                  <label htmlFor={systolicId} className="text-sm text-gray-600">Systolic</label>
                  <input id={systolicId} type="number" value={systolic} onChange={e => setSystolic(e.target.value)}
                    step="1" min="0" placeholder="120"
                    className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-800 text-xl" />
                </div>
                <span className="text-gray-500 font-bold text-2xl pb-2">/</span>
                <div className="flex flex-col gap-1 flex-1">
                  <label htmlFor={diastolicId} className="text-sm text-gray-600">Diastolic</label>
                  <input id={diastolicId} type="number" value={diastolic} onChange={e => setDiastolic(e.target.value)}
                    step="1" min="0" placeholder="80"
                    className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-800 text-xl" />
                </div>
                <span className="bg-fc-blue text-white font-bold border border-gray-300 rounded px-3 py-2 text-sm shrink-0">
                  mmHg
                </span>
              </div>
            </div>
          ) : isHydration ? (
            <div className="flex flex-col gap-3">
              <label className="font-bold text-gray-800">Amount:</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { ml: 150, label: "Small glass" },
                  { ml: 250, label: "Glass" },
                  { ml: 330, label: "Can" },
                  { ml: 500, label: "Bottle" },
                ] as const).map(p => (
                  <button key={p.ml} type="button"
                    onClick={() => { setValue(String(p.ml)); setUnit("mL") }}
                    className="rounded-xl px-4 py-3 text-sm font-semibold border-2 transition-colors bg-white text-gray-800 border-gray-300 hover:border-fc-blue active:bg-fc-blue active:text-white active:border-fc-blue">
                    {p.ml}mL<br />
                    <span className="font-normal text-xs">{p.label}</span>
                  </button>
                ))}
                <p className="col-span-2 text-sm font-semibold text-gray-700">Custom amount</p>
              </div>
              <div className="flex gap-2">
                <input type="number" value={value} onChange={e => setValue(e.target.value)}
                  step="1" min="0" placeholder="0"
                  className="w-32 bg-white border border-gray-300 rounded px-3 py-2 text-gray-800 text-xl" />
                <select value={unit} onChange={e => setUnit(e.target.value)}
                  className="flex-1 bg-fc-blue text-white font-bold border border-gray-300 rounded px-3 py-2">
                  <option value="mL">mL</option>
                  <option value="L">L</option>
                </select>
              </div>
            </div>
          ) : (
            <div>
              <label className="font-bold text-gray-800 block mb-1">Value:</label>
              <div className="flex gap-2">
                <input type="number" value={value} onChange={e => setValue(e.target.value)}
                  step={step} min="0" placeholder="0"
                  className="w-32 bg-white border border-gray-300 rounded px-3 py-2 text-gray-800 text-xl" />
                <select value={unit} onChange={e => setUnit(e.target.value)}
                  className="flex-1 bg-fc-blue text-white font-bold border border-gray-300 rounded px-3 py-2">
                  {units.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
          )}

          <div>
            <label className="font-bold text-gray-800 block mb-1">Comments:</label>
            <textarea value={comments} onChange={e => setComments(e.target.value)} rows={3}
              className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-800 resize-none" />
          </div>

          {error && <p className="text-red-600 text-sm font-medium">{error}</p>}

          <button onClick={handleSave} disabled={saving}
            className="self-end bg-fc-blue text-white font-bold px-6 py-3 rounded-xl
                       hover:bg-fc-blue-mid active:bg-fc-blue-dark disabled:opacity-50 transition-colors">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </main>
      <AppFooter />
    </div>
  )
}
