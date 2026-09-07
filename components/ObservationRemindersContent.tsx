// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { ObservationTypeConfig, Person } from "@/lib/domain-types"
import { fractionalAgeYears } from "@/lib/person/person-age"
import { PanelOutlineRemoveButton } from "@/components/EntityRowActions"
import type { ObservationCadence } from "@/lib/observation/observation-recurrence"
import { dashboardScheduleHeaders } from "@/lib/dashboard/dashboard-client-context"
import { mainContentTargetProps } from "@/lib/a11y"

type ApiRow = {
  id: number
  person_id: number
  observation_type: string
  cadence: ObservationCadence
  interval_days: number | null
  recurrence_day_of_month: number | null
  recurrence_month: number | null
  recurrence_day: number | null
  recurrence_use_birthday: number
  enabled: number
  due_time_hhmm: string | null
  tz: string | null
  last_recorded_at?: string | null
  next_due_at?: string | null
}

const CADENCES: { value: ObservationCadence; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
  { value: "custom_days", label: "Custom (days)" },
]

function ageYears(dob: string | null, timeZone: string | null): number | null {
  if (!dob || !timeZone) return null
  const age = fractionalAgeYears(dob, timeZone)
  return Number.isFinite(age) ? age : null
}

interface FormRow {
  key: string
  serverId?: number
  observation_type: string
  cadence: ObservationCadence
  interval_days: number | null
  recurrence_day_of_month: number | null
  recurrence_month: number | null
  recurrence_day: number | null
  recurrence_use_birthday: boolean
  due_time_hhmm: string
  last_recorded_at?: string | null
  next_due_at?: string | null
}

function rowToForm(r: ApiRow): FormRow {
  return {
    key: `expect-${r.id}`,
    serverId: r.id,
    observation_type: r.observation_type,
    cadence: r.cadence,
    interval_days: r.interval_days ?? (r.cadence === "weekly" ? 7 : null),
    recurrence_day_of_month: r.recurrence_day_of_month,
    recurrence_month: r.recurrence_month,
    recurrence_day: r.recurrence_day,
    recurrence_use_birthday: r.recurrence_use_birthday === 1,
    due_time_hhmm: (r.due_time_hhmm?.trim() || "00:00").slice(0, 5),
    last_recorded_at: r.last_recorded_at ?? null,
    next_due_at: r.next_due_at ?? null,
  }
}

function formRowToSinglePayload(r: FormRow): Record<string, unknown> {
  const base: Record<string, unknown> = {
    observation_type: r.observation_type,
    cadence: r.cadence,
    enabled: true,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
  if (r.cadence === "daily" || r.cadence === "monthly" || r.cadence === "yearly") {
    base.due_time_hhmm = r.due_time_hhmm.trim() || "00:00"
  }
  if (r.cadence === "weekly" || r.cadence === "custom_days") {
    base.interval_days = r.interval_days ?? (r.cadence === "weekly" ? 7 : 1)
    base.due_time_hhmm = "00:00"
  }
  if (r.cadence === "monthly") {
    base.recurrence_use_birthday = r.recurrence_use_birthday
    if (!r.recurrence_use_birthday) {
      base.recurrence_day_of_month = r.recurrence_day_of_month ?? 1
    }
  }
  if (r.cadence === "yearly") {
    base.recurrence_use_birthday = r.recurrence_use_birthday
    if (!r.recurrence_use_birthday) {
      base.recurrence_month = r.recurrence_month ?? 1
      base.recurrence_day = r.recurrence_day ?? 1
    }
  }
  return base
}

function summarizeObservation(row: FormRow): string {
  const cad = CADENCES.find(c => c.value === row.cadence)?.label ?? row.cadence
  let extra = ""
  if (row.last_recorded_at) {
    extra += ` · Last recorded: ${new Date(row.last_recorded_at).toLocaleString("en-AU")}`
  }
  if (row.next_due_at) {
    extra += ` · Next due: ${new Date(row.next_due_at).toLocaleString("en-AU")}`
  }
  return `${row.observation_type} · ${cad}${extra}`
}

export default function ObservationRemindersContent({ personId }: { personId: string }) {
  const [person, setPerson] = useState<Person | null>(null)
  const [rows, setRows] = useState<FormRow[]>([])
  const [typeConfigs, setTypeConfigs] = useState<ObservationTypeConfig[]>([])
  const [instanceTimezone, setInstanceTimezone] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set())
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [pRes, eRes, cRes, meRes] = await Promise.all([
        fetch(`/api/people/${personId}`),
        fetch(`/api/people/${personId}/observation-expectations`, { headers: dashboardScheduleHeaders() }),
        fetch("/api/observation-type-config"),
        fetch("/api/me"),
      ])
      if (!pRes.ok) throw new Error("Could not load person")
      if (!eRes.ok) throw new Error("Could not load expectations")
      if (!cRes.ok) throw new Error("Could not load Observation Types")
      const p = (await pRes.json()) as Person
      const data = (await eRes.json()) as { expectations: ApiRow[] }
      const cfgs = (await cRes.json()) as ObservationTypeConfig[]
      setPerson(p)
      setTypeConfigs(cfgs)
      setRows(data.expectations.map(rowToForm))
      if (meRes.ok) {
        const me = (await meRes.json()) as { instanceTimezone?: string }
        if (typeof me.instanceTimezone === "string" && me.instanceTimezone.trim() !== "") {
          setInstanceTimezone(me.instanceTimezone)
        }
      }

      const clientTz = Intl.DateTimeFormat().resolvedOptions().timeZone
      const nullTzRows = data.expectations.filter(r => r.enabled === 1 && r.tz == null)
      if (nullTzRows.length > 0) {
        await Promise.allSettled(
          nullTzRows.map(r =>
            fetch(`/api/people/${personId}/observation-expectations?id=${r.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tz: clientTz }),
            }),
          ),
        )
      }
    } catch {
      setError("Failed to load settings.")
    } finally {
      setLoading(false)
    }
  }, [personId])

  useEffect(() => {
    load()
  }, [load])

  const usedTypes = useMemo(() => new Set(rows.map(r => r.observation_type)), [rows])

  const configsAllowedByAge = useMemo(() => {
    const ay = ageYears(person?.date_of_birth ?? null, instanceTimezone)
    return typeConfigs.filter(cfg => {
      if (cfg.is_active === 0) return false
      if (cfg.max_age_years == null) return true
      if (ay === null) return true
      return ay <= cfg.max_age_years
    })
  }, [typeConfigs, person?.date_of_birth, instanceTimezone])

  const observationTypeDropdownOptions = useMemo(() => {
    const allowedCanon = configsAllowedByAge.map(c => c.observation_type)
    const allowedLc = new Set(allowedCanon.map(t => t.toLowerCase()))
    const legacyNames = [...new Set(rows.map(r => r.observation_type))].filter(
      name => !allowedLc.has(name.toLowerCase()),
    )
    const orderMap = new Map(
      typeConfigs.map(c => [c.observation_type.toLowerCase(), c.sort_order] as const),
    )
    const sortedAllowed = [...allowedCanon].sort((a, b) => {
      const oa = orderMap.get(a.toLowerCase()) ?? 999
      const ob = orderMap.get(b.toLowerCase()) ?? 999
      if (oa !== ob) return oa - ob
      return a.localeCompare(b)
    })
    return [...legacyNames.sort((a, b) => a.localeCompare(b)), ...sortedAllowed]
  }, [configsAllowedByAge, rows, typeConfigs])

  function toggleExpanded(key: string) {
    setExpandedKeys(prev => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  }

  function addRow() {
    const pick =
      configsAllowedByAge.find(c => !usedTypes.has(c.observation_type))?.observation_type
      ?? observationTypeDropdownOptions[0]
      ?? "Weight"
    const key = `new-${Date.now()}`
    setRows(rs => [
      ...rs,
      {
        key,
        observation_type: pick,
        cadence: "daily",
        interval_days: null,
        recurrence_day_of_month: 1,
        recurrence_month: 1,
        recurrence_day: 1,
        recurrence_use_birthday: false,
        due_time_hhmm: "00:00",
        last_recorded_at: null,
        next_due_at: null,
      },
    ])
    setExpandedKeys(prev => new Set(prev).add(key))
  }

  function updateRow(key: string, patch: Partial<FormRow>) {
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)))
  }

  async function handleRemove(row: FormRow) {
    setError("")
    if (row.serverId != null) {
      try {
        const res = await fetch(
          `/api/people/${personId}/observation-expectations?id=${row.serverId}`,
          { method: "DELETE", headers: dashboardScheduleHeaders() },
        )
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          setError(typeof j.error === "string" ? j.error : "Could not remove.")
          return
        }
        setExpandedKeys(prev => {
          const n = new Set(prev)
          n.delete(row.key)
          return n
        })
        setRows(rs => rs.filter(r => r.key !== row.key))
      } catch {
        setError("Could not remove.")
      }
      return
    }
    setExpandedKeys(prev => {
      const n = new Set(prev)
      n.delete(row.key)
      return n
    })
    setRows(rs => rs.filter(r => r.key !== row.key))
  }

  async function handleSaveRow(row: FormRow) {
    if (!person) return
    setError("")
    setSavingKey(row.key)
    const payload = formRowToSinglePayload(row)
    try {
      if (row.serverId != null) {
        const res = await fetch(
          `/api/people/${personId}/observation-expectations?id=${row.serverId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...dashboardScheduleHeaders() },
            body: JSON.stringify(payload),
          },
        )
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(typeof json.error === "string" ? json.error : "Save failed")
          return
        }
        const exp = json as { expectation?: ApiRow }
        if (exp.expectation) {
          setRows(rs => rs.map(r => (r.key === row.key ? rowToForm(exp.expectation!) : r)))
        }
      } else {
        const res = await fetch(`/api/people/${personId}/observation-expectations`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...dashboardScheduleHeaders() },
          body: JSON.stringify(payload),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(typeof json.error === "string" ? json.error : "Save failed")
          return
        }
        const exp = json as { expectation?: ApiRow }
        if (exp.expectation) {
          setRows(rs => rs.map(r => (r.key === row.key ? rowToForm(exp.expectation!) : r)))
        }
      }
      setExpandedKeys(prev => {
        const n = new Set(prev)
        n.delete(row.key)
        return n
      })
    } catch {
      setError("Save failed.")
    } finally {
      setSavingKey(null)
    }
  }

  const fieldSelect =
    "w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-800 min-w-0"
  const fieldInput =
    "bg-white border border-gray-300 rounded px-3 py-2 text-gray-800"

  if (loading) {
    return (
      <div className="flex-1 bg-fc-blue flex items-center justify-center">
        <div className="text-white text-lg">Loading…</div>
      </div>
    )
  }

  return (
    <main {...mainContentTargetProps} className="flex-1 bg-fc-blue overflow-y-auto fc-scroll">
      <div className="bg-fc-panel m-3 rounded-xl p-4 flex flex-col gap-4">
        <p className="text-sm text-gray-600 leading-relaxed">
          Set how often each Observation Type should be recorded for this person. This drives Observation Reminders on the home screen.
          Expand a row to edit; tap <strong className="text-gray-800">Save</strong> to store and collapse. Types come from{" "}
          <strong className="text-gray-800">Management → Observation Types</strong>; with a date of birth, age-limited types follow the catalogue (e.g. Head Circumference).
        </p>
        {person && !person.date_of_birth && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Add a date of birth on the Manage People screen to use &quot;On birthday&quot; recurrence.
          </p>
        )}

        {rows.map(row => {
          const expanded = expandedKeys.has(row.key)
          return (
            <div
              key={row.key}
              className="flex flex-col gap-3 pt-4 border-t border-gray-300 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-wrap items-start gap-2">
                <button
                  type="button"
                  onClick={() => toggleExpanded(row.key)}
                  className="flex flex-1 min-w-0 items-start gap-2 rounded-lg text-left hover:bg-white/40 transition-colors px-1 py-0.5 -mx-1"
                >
                  <span className="text-gray-500 text-xl leading-none shrink-0 mt-0.5 w-5">
                    {expanded ? "▼" : "›"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-gray-800 text-lg leading-tight">{row.observation_type}</div>
                    <div className="text-gray-600 text-xs mt-1 leading-snug">{summarizeObservation(row)}</div>
                  </div>
                </button>
                <PanelOutlineRemoveButton onClick={() => handleRemove(row)}>Remove</PanelOutlineRemoveButton>
              </div>

              {expanded && (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="font-bold text-gray-800">Observation Type</span>
                    <select
                      value={row.observation_type}
                      onChange={e => updateRow(row.key, { observation_type: e.target.value })}
                      className={fieldSelect}
                    >
                      {observationTypeDropdownOptions.map(t => (
                        <option key={t} value={t} disabled={usedTypes.has(t) && t !== row.observation_type}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="font-bold text-gray-800 block mb-1">Cadence</label>
                    <select
                      value={row.cadence}
                      onChange={e => {
                        const cadence = e.target.value as ObservationCadence
                        updateRow(row.key, {
                          cadence,
                          interval_days:
                            cadence === "weekly"
                              ? (row.interval_days ?? 7)
                              : cadence === "custom_days"
                                ? (row.interval_days ?? 14)
                                : null,
                        })
                      }}
                      className={fieldSelect}
                    >
                      {CADENCES.map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>

                  {(row.cadence === "daily" || row.cadence === "monthly" || row.cadence === "yearly") && (
                    <div>
                      <label className="font-bold text-gray-800 block mb-1">Due time (local)</label>
                      <p className="text-xs text-gray-600 mb-1">
                        Home reminders use this clock time with your device timezone (same as medication schedules).
                      </p>
                      <input
                        type="time"
                        value={row.due_time_hhmm}
                        onChange={e => updateRow(row.key, { due_time_hhmm: e.target.value })}
                        className={`${fieldInput} w-40`}
                      />
                    </div>
                  )}

                  {(row.cadence === "weekly" || row.cadence === "custom_days") && (
                    <div>
                      <label className="font-bold text-gray-800 block mb-1">Every (days)</label>
                      <input
                        type="number"
                        min={0.5}
                        step={0.5}
                        value={row.interval_days ?? ""}
                        onChange={e =>
                          updateRow(row.key, { interval_days: parseFloat(e.target.value) || null })
                        }
                        className={`${fieldInput} w-32`}
                      />
                    </div>
                  )}

                  {row.cadence === "monthly" && (
                    <div className="flex flex-col gap-2 border-t border-gray-300 pt-3">
                      <span className="font-bold text-gray-800">Monthly on</span>
                      <label className="flex items-center gap-2 text-gray-800 text-sm">
                        <input
                          type="radio"
                          className="accent-fc-blue"
                          checked={!row.recurrence_use_birthday}
                          onChange={() => updateRow(row.key, { recurrence_use_birthday: false })}
                        />
                        Day of month
                      </label>
                      {!row.recurrence_use_birthday && (
                        <input
                          type="number"
                          min={1}
                          max={31}
                          value={row.recurrence_day_of_month ?? ""}
                          onChange={e =>
                            updateRow(row.key, { recurrence_day_of_month: parseInt(e.target.value, 10) || null })
                          }
                          className={`${fieldInput} w-24 ml-6`}
                        />
                      )}
                      <label className="flex items-center gap-2 text-gray-800 text-sm">
                        <input
                          type="radio"
                          className="accent-fc-blue"
                          checked={row.recurrence_use_birthday}
                          disabled={!person?.date_of_birth}
                          onChange={() => updateRow(row.key, { recurrence_use_birthday: true })}
                        />
                        Birthday (day of month from DOB)
                      </label>
                    </div>
                  )}

                  {row.cadence === "yearly" && (
                    <div className="flex flex-col gap-2 border-t border-gray-300 pt-3">
                      <span className="font-bold text-gray-800">Yearly on</span>
                      <label className="flex items-center gap-2 text-gray-800 text-sm">
                        <input
                          type="radio"
                          className="accent-fc-blue"
                          checked={!row.recurrence_use_birthday}
                          onChange={() => updateRow(row.key, { recurrence_use_birthday: false })}
                        />
                        Calendar date
                      </label>
                      {!row.recurrence_use_birthday && (
                        <div className="flex flex-wrap gap-2 ml-6">
                          <select
                            value={row.recurrence_month ?? 1}
                            onChange={e =>
                              updateRow(row.key, { recurrence_month: parseInt(e.target.value, 10) })
                            }
                            className={fieldSelect}
                          >
                            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                              <option key={m} value={m}>
                                {new Date(2000, m - 1, 1).toLocaleString("en-AU", { month: "long" })}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min={1}
                            max={31}
                            value={row.recurrence_day ?? ""}
                            onChange={e =>
                              updateRow(row.key, { recurrence_day: parseInt(e.target.value, 10) || null })
                            }
                            className={`${fieldInput} w-20`}
                          />
                        </div>
                      )}
                      <label className="flex items-center gap-2 text-gray-800 text-sm">
                        <input
                          type="radio"
                          className="accent-fc-blue"
                          checked={row.recurrence_use_birthday}
                          disabled={!person?.date_of_birth}
                          onChange={() => updateRow(row.key, { recurrence_use_birthday: true })}
                        />
                        Birthday (month and day from DOB)
                      </label>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={savingKey === row.key}
                    onClick={() => handleSaveRow(row)}
                    className="self-end bg-fc-blue text-white font-bold px-6 py-3 rounded-xl hover:bg-fc-blue-mid
                               active:bg-fc-blue-dark disabled:opacity-50 transition-colors"
                  >
                    {savingKey === row.key ? "Saving…" : "Save"}
                  </button>
                </>
              )}
            </div>
          )
        })}

        <button
          type="button"
          onClick={addRow}
          className="self-start rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-800
                     hover:bg-gray-50 transition-colors"
        >
          Add Observation Reminder
        </button>

        {error && <p className="text-red-600 text-sm font-medium">{error}</p>}
      </div>
    </main>
  )
}
