// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useState } from "react"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import Chip from "@/components/ui/Chip"
import { Input, Select } from "@/components/ui/controls"
import FormField, { FieldGroup } from "@/components/ui/FormField"
import IconButton from "@/components/ui/IconButton"
import { formatDate } from "@/lib/date-format"
import { disabledWhen } from "@/lib/ui/disabled-props"
import { parseScheduleTimesJson } from "@/lib/medication/medication-schedule"

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

interface ExpectationRow {
  id: number
  person_medication_id: number
  slot_hhmm: string
  start_date: string
  end_date: string
  weekdays: number[] | null
  exceptions: string[]
  outcomes: { local_ymd: string; status: "confirmed_given" | "confirmed_missed" }[]
}

const OUTCOME_LABEL = { confirmed_given: "Given", confirmed_missed: "Not given" } as const

function summarise(e: ExpectationRow): string {
  const days = e.weekdays ? e.weekdays.map(d => WEEKDAY_LABELS[d]).join(", ") : "every day"
  return `${formatDate(e.start_date)} to ${formatDate(e.end_date)} · ${days}`
}

/**
 * Parent-defined "this dose is given away from home" terms for one scheduled medication: per dose
 * time, a date range (e.g. a school term), an optional weekday filter and one-off skip days. All
 * dates are typed in — never read from an external calendar.
 */
export default function DoseExpectationsPanel({
  personId,
  personMedicationId,
  scheduleTimesJson,
}: {
  personId: string
  personMedicationId: number
  /** The saved schedule's times, so slots can only be chosen from doses that actually exist. */
  scheduleTimesJson: string | null
}) {
  const times = parseScheduleTimesJson(scheduleTimesJson)
  const [rows, setRows] = useState<ExpectationRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const [slot, setSlot] = useState(times[0] ?? "")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [exceptionInputs, setExceptionInputs] = useState<Record<number, string>>({})

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`/api/people/${personId}/dose-expectations`)
      if (!res.ok) throw new Error("load failed")
      const all = (await res.json()) as ExpectationRow[]
      setRows(all.filter(r => r.person_medication_id === personMedicationId))
      setError("")
    } catch {
      setError("Could not load away-from-home doses.")
    } finally {
      setLoaded(true)
    }
  }, [personId, personMedicationId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!times.includes(slot)) setSlot(times[0] ?? "")
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `times` is derived from the prop below
  }, [scheduleTimesJson])

  async function call(url: string, init: RequestInit): Promise<boolean> {
    setBusy(true)
    setError("")
    try {
      const res = await fetch(url, init)
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? "Could not save that change.")
        return false
      }
      await load()
      return true
    } catch {
      setError("Could not save that change.")
      return false
    } finally {
      setBusy(false)
    }
  }

  async function addTerm(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const ok = await call(`/api/people/${personId}/dose-expectations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        person_medication_id: personMedicationId,
        slot_hhmm: slot,
        start_date: startDate,
        end_date: endDate,
        weekdays,
      }),
    })
    if (ok) {
      setStartDate("")
      setEndDate("")
    }
  }

  const json = { "Content-Type": "application/json" }

  if (times.length === 0) {
    return (
      <p className="fc-field__hint">
        Save at least one scheduled time to mark doses as given away from home (for example at school).
      </p>
    )
  }

  return (
    <section aria-label="Given away from home" className="fc-form fc-form--top-rule">
      <div>
        <h3 className="fc-section-title">Given away from home</h3>
        <p className="fc-section-copy">
          For a dose someone else gives at a regular time, such as at school during term. Home alerts
          for that dose are replaced by a question asking whether it was given. Enter the dates yourself.
        </p>
      </div>

      {!loaded ? (
        <p className="fc-field__hint">Loading…</p>
      ) : (
        rows.map(r => (
          <div key={r.id} className="fc-subform">
            <div className="fc-value-row__head">
              <div>
                <p className="fc-value-row__title">{r.slot_hhmm} dose</p>
                <p className="fc-field__hint">{summarise(r)}</p>
              </div>
              <Button
                variant="destructive"
                aria-label={`Remove the ${r.slot_hhmm} dose term`}
                onClick={() => void call(`/api/dose-expectations/${r.id}`, { method: "DELETE" })}
                {...disabledWhen(busy && "Saving your change…")}
              >
                Remove
              </Button>
            </div>

            <FieldGroup label="Days off" hint="Holidays, pupil-free days and sick days.">
              {r.exceptions.length > 0 && (
                <ul className="fc-chip-set__chips fc-pill-list">
                  {r.exceptions.map(ymd => (
                    <li key={ymd} className="fc-pill">
                      {formatDate(ymd)}
                      <IconButton
                        label={`Remove ${formatDate(ymd)}`}
                        disabled={busy}
                        onClick={() =>
                          void call(`/api/dose-expectations/${r.id}/exceptions?local_ymd=${ymd}`, { method: "DELETE" })
                        }
                      >
                        ×
                      </IconButton>
                    </li>
                  ))}
                </ul>
              )}
              <div className="fc-field__row">
                <Input
                  type="date"
                  aria-label="Day off"
                  value={exceptionInputs[r.id] ?? ""}
                  onChange={e => setExceptionInputs(prev => ({ ...prev, [r.id]: e.target.value }))}
                />
                <Button
                  variant="secondary"
                  onClick={async () => {
                    const ok = await call(`/api/dose-expectations/${r.id}/exceptions`, {
                      method: "POST",
                      headers: json,
                      body: JSON.stringify({ local_ymd: exceptionInputs[r.id] }),
                    })
                    if (ok) setExceptionInputs(prev => ({ ...prev, [r.id]: "" }))
                  }}
                  {...disabledWhen((busy && "Saving your change…") || (!exceptionInputs[r.id] && "Choose a day off first."))}
                >
                  Add day off
                </Button>
              </div>
            </FieldGroup>

            {r.outcomes.length > 0 && (
              <div>
                <p className="fc-field__label">Recent answers</p>
                <ul className="fc-field__hint fc-plain-list">
                  {r.outcomes.slice(0, 5).map(o => (
                    <li key={o.local_ymd}>
                      {formatDate(o.local_ymd)}: {OUTCOME_LABEL[o.status]}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))
      )}

      <form onSubmit={e => void addTerm(e)} className="fc-subform">
        <h4 className="fc-field__label">Add a term</h4>
        <FormField label="Dose time">
          <Select value={slot} onChange={e => setSlot(e.target.value)}>
            {times.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </FormField>
        <div className="fc-form-pair">
          <FormField label="From">
            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
          </FormField>
          <FormField label="To">
            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required />
          </FormField>
        </div>
        <FieldGroup label="Days of the week">
          <div className="fc-chip-set__chips">
            {WEEKDAY_LABELS.map((label, d) => {
              const on = weekdays.includes(d)
              return (
                <Chip
                  key={label}
                  kind="toggle"
                  pressed={on}
                  onPressedChange={() => setWeekdays(prev => (on ? prev.filter(x => x !== d) : [...prev, d].sort((a, b) => a - b)))}
                >
                  {label}
                </Chip>
              )
            })}
          </div>
        </FieldGroup>
        {error && <Banner kind="error">{error}</Banner>}
        <div className="fc-actions-end">
          <Button
            type="submit"
            {...disabledWhen((busy && "Saving your change…") || ((!startDate || !endDate) && "Enter the from and to dates first."))}
          >
            Add term
          </Button>
        </div>
      </form>
    </section>
  )
}
