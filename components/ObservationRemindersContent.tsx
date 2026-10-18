// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import { ChipGroup } from "@/components/ui/Chip"
import { Input, Select } from "@/components/ui/controls"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import EntityRowActions from "@/components/ui/EntityRowActions"
import FormField, { FieldRow } from "@/components/ui/FormField"
import ListCard, { CardList } from "@/components/ui/ListCard"
import Panel from "@/components/ui/Panel"
import type { ObservationTypeConfig, Person } from "@/lib/domain-types"
import { formatDateTime, formatMonthName, getDeviceTimeZone } from "@/lib/date-format"
import { fractionalAgeYears } from "@/lib/person/person-age"
import type { ObservationCadence } from "@/lib/observation/observation-recurrence"
import { dashboardScheduleHeaders } from "@/lib/dashboard/dashboard-client-context"

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
    tz: getDeviceTimeZone(),
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

/** The card's meta line: how often, then when it was last recorded and when it is next due. */
function summarizeObservation(row: FormRow): (string | null)[] {
  const cad = CADENCES.find(c => c.value === row.cadence)?.label ?? row.cadence
  return [
    cad,
    row.last_recorded_at ? `Last recorded ${formatDateTime(row.last_recorded_at)}` : null,
    row.next_due_at ? `Next due ${formatDateTime(row.next_due_at)}` : null,
  ]
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

      const clientTz = getDeviceTimeZone()
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

  if (loading) {
    return <p className="fc-admin-note">Loading…</p>
  }

  return (
    <>
      <p className="fc-section-copy fc-surface-copy">
        Set how often each Observation Type should be recorded for this person. This drives Observation Reminders on the home screen.
        Choose Edit on a reminder to change it, then Save. Types come from Management › Observation Types; with a date of birth,
        age-limited types follow the catalogue (for example Head Circumference).
      </p>
      {person && !person.date_of_birth && (
        <Banner kind="warning">Add a date of birth on the People screen to use &quot;On birthday&quot; recurrence.</Banner>
      )}
      {error && <Banner kind="error" announced>{error}</Banner>}

      {rows.length === 0 && (
        <EmptyState icon={EMPTY_STATE_ICONS.noSchedules} heading="No observation reminders yet">
          Add one to be reminded to record an observation.
        </EmptyState>
      )}

      <CardList>
        {rows.map(row => {
          const expanded = expandedKeys.has(row.key)
          return (
            <Fragment key={row.key}>
              <ListCard
                icon="📏"
                title={row.observation_type}
                meta={summarizeObservation(row)}
                trailing={
                  <EntityRowActions
                    name={row.observation_type}
                    editLabel={expanded ? "Close" : "Edit"}
                    onEdit={() => toggleExpanded(row.key)}
                    deleteLabel="Remove"
                    onDelete={() => handleRemove(row)}
                  />
                }
              />
              {expanded && (
                <li>
                  <Panel>
                    <FormField label="Observation type">
                      <Select
                        value={row.observation_type}
                        onChange={e => updateRow(row.key, { observation_type: e.target.value })}
                      >
                        {observationTypeDropdownOptions.map(t => (
                          <option key={t} value={t} disabled={usedTypes.has(t) && t !== row.observation_type}>
                            {t}
                          </option>
                        ))}
                      </Select>
                    </FormField>

                    <FormField label="Cadence">
                      <Select
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
                      >
                        {CADENCES.map(c => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </Select>
                    </FormField>

                    {(row.cadence === "daily" || row.cadence === "monthly" || row.cadence === "yearly") && (
                      <FormField
                        label="Due time"
                        hint="Home reminders use this clock time with your device timezone (same as medication schedules)."
                      >
                        <Input type="time" value={row.due_time_hhmm} onChange={e => updateRow(row.key, { due_time_hhmm: e.target.value })} />
                      </FormField>
                    )}

                    {(row.cadence === "weekly" || row.cadence === "custom_days") && (
                      <FormField label="Every (days)">
                        <Input
                          type="number"
                          min={0.5}
                          step={0.5}
                          value={row.interval_days ?? ""}
                          onChange={e => updateRow(row.key, { interval_days: parseFloat(e.target.value) || null })}
                        />
                      </FormField>
                    )}

                    {row.cadence === "monthly" && (
                      <>
                        {person?.date_of_birth || row.recurrence_use_birthday ? (
                          <ChipGroup
                            legend="Monthly on"
                            value={row.recurrence_use_birthday ? "birthday" : "day"}
                            onChange={v => updateRow(row.key, { recurrence_use_birthday: v === "birthday" })}
                            options={[
                              { value: "day", label: "Day of month" },
                              { value: "birthday", label: "Birthday (day of month from DOB)" },
                            ]}
                          />
                        ) : null}
                        {!row.recurrence_use_birthday && (
                          <FormField label="Day of the month">
                            <Input
                              type="number"
                              min={1}
                              max={31}
                              value={row.recurrence_day_of_month ?? ""}
                              onChange={e => updateRow(row.key, { recurrence_day_of_month: parseInt(e.target.value, 10) || null })}
                            />
                          </FormField>
                        )}
                      </>
                    )}

                    {row.cadence === "yearly" && (
                      <>
                        {person?.date_of_birth || row.recurrence_use_birthday ? (
                          <ChipGroup
                            legend="Yearly on"
                            value={row.recurrence_use_birthday ? "birthday" : "date"}
                            onChange={v => updateRow(row.key, { recurrence_use_birthday: v === "birthday" })}
                            options={[
                              { value: "date", label: "Calendar date" },
                              { value: "birthday", label: "Birthday (month and day from DOB)" },
                            ]}
                          />
                        ) : null}
                        {!row.recurrence_use_birthday && (
                          <FormField label="Month and day">
                            <FieldRow>
                              <Select
                                aria-label="Month"
                                value={row.recurrence_month ?? 1}
                                onChange={e => updateRow(row.key, { recurrence_month: parseInt(e.target.value, 10) })}
                              >
                                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                                  <option key={m} value={m}>{formatMonthName(m)}</option>
                                ))}
                              </Select>
                              <Input
                                type="number"
                                min={1}
                                max={31}
                                value={row.recurrence_day ?? ""}
                                onChange={e => updateRow(row.key, { recurrence_day: parseInt(e.target.value, 10) || null })}
                              />
                            </FieldRow>
                          </FormField>
                        )}
                      </>
                    )}

                    <div className="fc-actions-end">
                      <Button onClick={() => handleSaveRow(row)} pending={savingKey === row.key}>Save</Button>
                    </div>
                  </Panel>
                </li>
              )}
            </Fragment>
          )
        })}
      </CardList>

      <div>
        <Button variant="secondary" onClick={addRow}>Add observation reminder</Button>
      </div>
    </>
  )
}
