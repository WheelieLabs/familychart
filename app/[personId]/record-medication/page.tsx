// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import { PersonHeader } from "@/components/AppHeader"
import Toggle from "@/components/Toggle"
import ConfirmModal, { confirmCopy } from "@/components/ConfirmModal"
import MedicationUnitMismatchModal from "@/components/MedicationUnitMismatchModal"
import type { FrequencyRule, Person } from "@/lib/domain-types"
import { localDateAndTimeToUtcIso, localDateToIsoYmd } from "@/lib/datetime"
import { completedCalendarYears } from "@/lib/person/person-age"
import { mainContentTargetProps } from "@/lib/a11y"
import { evaluatePrnState } from "@/lib/prn/prn-eval"
import { ruleMax24hIsDoseCount } from "@/lib/frequency-rule"
import { findNextSuppressibleSlot } from "@/lib/schedule/schedule-slot-evaluator"
import type { CalendarContext } from "@/lib/calendar-context"
import { parseScheduleFrequencyJson } from "@/lib/schedule/schedule-recurrence"

function formatSlotTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number)
  const period = h < 12 ? "AM" : "PM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, "0")} ${period}`
}

function ruleMax24hCountsDoses(r: FrequencyRule | null | undefined): boolean {
  return ruleMax24hIsDoseCount(r)
}

interface MedGroup { id: number; name: string }

interface MedicationResult {
  id: number; name: string
  default_dosage: number | null; dosage_unit: string
  notes: string | null
  min_age_years: number | null
  max_age_years: number | null
  groups: MedGroup[]
  /** Present when fetched with person_id — matches server used for dashboard dose timing. */
  server_now?: string
  applicable_rule: FrequencyRule | null
  total_taken_24h: number
  last_dose_at: string | null
  last_dose_med_name: string | null
  last_dose_remind_after_hours: number | null
  last_dosage: number | null
  oldest_in_window_at: string | null
  /** Scheduled slot times for this person-medication (HH:MM strings), empty when not scheduled. */
  schedule_times: string[]
  schedule_frequency?: string | null
  schedule_start_date?: string | null
  schedule_end_date?: string | null
  /** Server-resolved (incl. instance IANA fallback) — client never replicates that DB lookup. */
  schedule_calendar_context?: CalendarContext | null
}

/** Rule-specific dose overrides the medication catalogue default when set. */
function effectiveCatalogDosage(med: MedicationResult): number | null {
  const d = med.applicable_rule?.dosage
  if (d != null) return d
  return med.default_dosage
}

import { MEDICATION_DOSAGE_UNITS } from "@/lib/medication/medication-units"

const DOSAGE_UNITS = [...MEDICATION_DOSAGE_UNITS]

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

function toLocalDatetime(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return {
    date: localDateToIsoYmd(d),
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

function formatHm(hours: number): string {
  const h = Math.floor(Math.abs(hours))
  const m = Math.round((Math.abs(hours) - h) * 60)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

const HOURS_PER_DAY = 24
const HOURS_PER_WEEK = 168

/** Elapsed or remaining time: minutes → hours → days → weeks (en-AU style). */
function formatDurationHuman(hours: number): string {
  const abs = Math.abs(hours)
  if (abs < 1 / 60) return "0m"
  if (abs < 1) return `${Math.max(1, Math.round(abs * 60))}m`
  if (abs < HOURS_PER_DAY) return formatHm(abs)

  if (abs < HOURS_PER_WEEK) {
    const d = Math.floor(abs / HOURS_PER_DAY)
    const rem = abs - d * HOURS_PER_DAY
    const h = Math.floor(rem)
    const m = Math.round((rem - h) * 60)
    let s = `${d} day${d === 1 ? "" : "s"}`
    if (h > 0 && m > 0) s += ` ${h}h ${m}m`
    else if (h > 0) s += ` ${h}h`
    else if (m > 0) s += ` ${m}m`
    return s
  }

  const w = Math.floor(abs / HOURS_PER_WEEK)
  const remW = abs - w * HOURS_PER_WEEK
  const d = Math.floor(remW / HOURS_PER_DAY)
  const remD = remW - d * HOURS_PER_DAY
  const h = Math.floor(remD)
  const m = Math.round((remD - h) * 60)
  let s = `${w} week${w === 1 ? "" : "s"}`
  if (d > 0) s += ` ${d} day${d === 1 ? "" : "s"}`
  else if (h > 0 && m > 0) s += ` ${h}h ${m}m`
  else if (h > 0) s += ` ${h}h`
  else if (m > 0) s += ` ${m}m`
  return s
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true })
}

function formatDateTime(d: Date, refNow: Date): string {
  const now = refNow
  const isToday    = d.toDateString() === now.toDateString()
  const tomorrow   = new Date(now); tomorrow.setDate(now.getDate() + 1)
  const isTomorrow = d.toDateString() === tomorrow.toDateString()
  const time = formatTime(d)
  if (isToday)    return `today at ${time}`
  if (isTomorrow) return `tomorrow at ${time}`
  return `${d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })} at ${time}`
}

function formatWeightRecordedCaption(d: Date): string {
  const datePart = d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
  return `${datePart} at ${formatTime(d)}`
}

function ruleHasWeightRange(rule: FrequencyRule | null): boolean {
  if (!rule) return false
  return rule.min_weight_kg != null || rule.max_weight_kg != null
}

/** Lead phrase for the dosing guide when no med is selected yet. */
function ruleDosingGuideIntervalLine(r: FrequencyRule): string {
  if (r.min_hours_between === 0) {
    return r.max_hours_between != null
      ? `As required; typical spacing 0–${r.max_hours_between} hrs`
      : "As required between doses (no minimum interval)"
  }
  const interval = r.max_hours_between != null
    ? `${r.min_hours_between}–${r.max_hours_between} hrs`
    : `${r.min_hours_between} hrs`
  return `Every ${interval}`
}

function ruleInfoText(r: FrequencyRule, qtyUnit: string): string {
  const parts: string[] = [ruleDosingGuideIntervalLine(r)]
  if (r.max_quantity_per_24h != null) {
    if (ruleMax24hCountsDoses(r)) {
      parts.push(`max ${r.max_quantity_per_24h} doses per 24h`)
    } else {
      parts.push(`max ${r.max_quantity_per_24h} ${qtyUnit} per 24h`)
    }
  }
  return parts.join(" · ")
}

function DosageStatusPanel({
  rule, lastDoseAt, lastDoseMedName, lastDoseRemindAfterHours, lastDosage, catalogDefaultDosage,
  groups, totalTaken24h, dosageUnit, catalogQtyUnit, now, oldestInWindowAt,
}: {
  rule: FrequencyRule | null
  lastDoseAt: Date | null
  lastDoseMedName: string | null
  lastDoseRemindAfterHours: number | null
  lastDosage: number | null
  catalogDefaultDosage: number | null
  groups: MedGroup[]
  totalTaken24h: number
  dosageUnit: string
  catalogQtyUnit: string
  now: Date
  oldestInWindowAt: string | null
}) {
  if (!rule) {
    return (
      <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2 text-sm">
        ℹ️ No dosing limits configured for this medication
      </div>
    )
  }

  const lastDose = lastDoseAt
    ? {
        lastIso: lastDoseAt.toISOString(),
        remindAfterHours: lastDoseRemindAfterHours,
        lastMedName: lastDoseMedName,
      }
    : null
  const ev = evaluatePrnState(
    {
      rule,
      total24h: totalTaken24h,
      lastDose,
      oldest24h: oldestInWindowAt,
      lastDosage,
      catalogDefaultDosage,
    },
    now,
  )

  const hoursSince = lastDoseAt
    ? (now.getTime() - lastDoseAt.getTime()) / 3600000
    : null

  const count24hDoses = ruleMax24hCountsDoses(rule)
  const unitMismatch = rule.max_quantity_per_24h != null &&
    !count24hDoses &&
    dosageUnit !== catalogQtyUnit

  if (ev.atCap) {
    const windowClearsAt = ev.resetAtMs != null ? new Date(ev.resetAtMs) : null
    return (
      <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2 text-sm">
        <div className="font-semibold">⛔ {count24hDoses ? "Maximum doses reached" : "Maximum quantity reached"}</div>
        <div className="text-xs mt-0.5">
          {count24hDoses ? (
            <>{totalTaken24h} of {rule.max_quantity_per_24h} doses taken in the last 24 hours.</>
          ) : (
            <>{totalTaken24h} of {rule.max_quantity_per_24h} {catalogQtyUnit} taken in the last 24 hours.</>
          )}
        </div>
        {windowClearsAt && (
          <div className="text-xs">Next dose available: {formatDateTime(windowClearsAt, now)}</div>
        )}
      </div>
    )
  }

  if (ev.cooldown && lastDoseAt && ev.availableAtMs != null) {
    const nextDoseAt = new Date(ev.availableAtMs)
    const remaining = (nextDoseAt.getTime() - now.getTime()) / 3600000
    const intervalCompact = rule.max_hours_between != null
      ? `${rule.min_hours_between}–${rule.max_hours_between}`
      : `${rule.min_hours_between}`
    const intervalLine = rule.min_hours_between === 0
      ? (rule.max_hours_between != null
        ? `0–${rule.max_hours_between} hrs (as required)`
        : "as required (no minimum interval)")
      : `every ${intervalCompact} hours`
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-sm">
        <div className="font-semibold">⚠️ Too soon to dose</div>
        <div className="text-xs mt-0.5">
          Last dose: {lastDoseMedName ?? "unknown"} — {formatDurationHuman(hoursSince!)} ago
        </div>
        {groups.length > 0 && (
          <div className="text-xs">Contains: {groups.map(g => g.name).join(", ")}</div>
        )}
        <div className="text-xs">
          Earliest next dose: in {formatDurationHuman(remaining)} (at {formatTime(nextDoseAt)})
        </div>
        <div className="text-xs">Interval: {intervalLine}</div>
        {unitMismatch && (
          <div className="text-xs mt-1">
            ℹ️ Dose limit tracking unavailable — unit mismatch
          </div>
        )}
      </div>
    )
  }

  if (unitMismatch) {
    return (
      <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2 text-sm">
        ℹ️ Dose limit tracking unavailable — unit mismatch
        (use {catalogQtyUnit} to track the 24h limit)
      </div>
    )
  }

  if (!lastDoseAt) {
    return (
      <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2 text-sm">
        <div className="font-semibold text-blue-800 mb-1">Dosing guide</div>
        <div className="text-xs text-blue-700">{ruleInfoText(rule, catalogQtyUnit)}</div>
      </div>
    )
  }

  return (
    <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg px-3 py-2 text-sm">
      <div className="font-semibold">Safe to give</div>
      <div className="text-xs mt-0.5">
        Last given {formatDurationHuman(hoursSince!)} ago.
        {rule.max_quantity_per_24h != null && (
          count24hDoses ? (
            <> {totalTaken24h} of {rule.max_quantity_per_24h} doses used in the last 24 hours.</>
          ) : (
            <> {totalTaken24h} of {rule.max_quantity_per_24h} {catalogQtyUnit} used in the last 24 hours.</>
          )
        )}
      </div>
    </div>
  )
}

export default function RecordMedicationPage() {
  const params   = useParams()
  const router   = useRouter()
  const searchParams = useSearchParams()
  const personId = params.personId as string
  const medicationIdFromUrl = searchParams.get("medication_id")
  const dosageFromUrl = searchParams.get("dosage")

  const [person, setPerson]               = useState<Person | null>(null)
  const [recordNow, setRecordNow]         = useState(true)
  const { date: todayDate, time: nowTime } = toLocalDatetime(new Date())
  const [date, setDate]                   = useState(todayDate)
  const [time, setTime]                   = useState(nowTime)
  const [medicationQuery, setMedicationQuery] = useState("")
  const [suggestions, setSuggestions]     = useState<MedicationResult[]>([])
  const [selectedMed, setSelectedMed]     = useState<MedicationResult | null>(null)
  const [dosage, setDosage]               = useState("")
  const [dosageUnit, setDosageUnit]       = useState("Tabs")
  const [comments, setComments]           = useState("")
  const [saving, setSaving]               = useState(false)
  const [error, setError]                 = useState("")
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [clockOffsetMs, setClockOffsetMs] = useState(0)
  const [nowTick, setNowTick] = useState(0)
  const [weightChecking, setWeightChecking]   = useState(false)
  const [weightPromptVisible, setWeightPromptVisible] = useState(false)
  const [recentWeight, setRecentWeight] = useState<{ kg: number; recordedAt: Date } | null>(null)
  const [weightFormOpen, setWeightFormOpen]       = useState(false)
  const [weightInput, setWeightInput]             = useState("")
  const [weightSaveError, setWeightSaveError]     = useState("")
  const [weightSaving, setWeightSaving]           = useState(false)
  const [selectedPrnHours, setSelectedPrnHours]   = useState<number | null>(null)
  const [suppressNextSlot, setSuppressNextSlot]   = useState(false)
  const [instanceTimezone, setInstanceTimezone]   = useState<string | null>(null)
  const [prnClearedNoticeOpen, setPrnClearedNoticeOpen] = useState(false)
  const [isManager, setIsManager] = useState(false)
  const [unitMismatchNotice, setUnitMismatchNotice] = useState<{
    recordId: number
    medication: MedicationResult
    recordedUnit: string
    recordedDosage: number | null
    prnCleared: boolean
  } | null>(null)

  useEffect(() => {
    fetch(`/api/people/${personId}`).then(r => r.json()).then(setPerson)
  }, [personId])

  useEffect(() => {
    fetch("/api/me")
      .then(r => (r.ok ? r.json() : null))
      .then((me: { instanceTimezone?: string; role?: string | null } | null) => {
        setIsManager(me?.role === "manager" || me?.role === "admin")
        if (typeof me?.instanceTimezone === "string" && me.instanceTimezone.trim() !== "") {
          setInstanceTimezone(me.instanceTimezone)
        }
      })
      .catch(() => {})
  }, [])

  const syncClockFromServer = useCallback((iso: string | undefined) => {
    if (!iso) return
    const t = Date.parse(iso)
    if (!Number.isFinite(t)) return
    setClockOffsetMs(t - Date.now())
  }, [])

  // `nowTick` bumps every minute so this advances without listing it in hook deps.
  const alignedNow = new Date(Date.now() + clockOffsetMs)

  // Advance aligned clock once per minute (same cadence as before).
  useEffect(() => {
    const interval = setInterval(() => setNowTick(t => t + 1), 60000)
    return () => clearInterval(interval)
  }, [])

  // Monotonic search token: only the most recently-issued search may write to
  // state. Guards against a slower earlier fetch resolving last and clobbering
  // newer results with a stale (often empty) list.
  const searchSeqRef = useRef(0)

  const searchMedications = useCallback(async (query: string) => {
    const seq = ++searchSeqRef.current
    if (query.length < 1) {
      if (seq === searchSeqRef.current) setSuggestions([])
      return
    }
    setLoadingStatus(true)
    try {
      const res = await fetch(
        `/api/medications?q=${encodeURIComponent(query)}&person_id=${personId}`
      )
      const data = await res.json()
      if (seq !== searchSeqRef.current) return
      const list = Array.isArray(data) ? data : []
      syncClockFromServer((list[0] as MedicationResult | undefined)?.server_now)
      setSuggestions(list)
    } catch {
      if (seq === searchSeqRef.current) setSuggestions([])
    } finally {
      if (seq === searchSeqRef.current) setLoadingStatus(false)
    }
  }, [personId, syncClockFromServer])

  useEffect(() => {
    let cancelled = false
    const qTrim = medicationQuery.trim()
    if (qTrim.length < 1) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    if (selectedMed && qTrim === selectedMed.name.trim()) return

    setShowSuggestions(true)

    const t = setTimeout(() => {
      void (async () => {
        await searchMedications(qTrim)
        if (cancelled) return
        if (selectedMed && medicationQuery.trim() === selectedMed.name.trim()) return
      })()
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [medicationQuery, searchMedications, selectedMed])

  useEffect(() => {
    setWeightFormOpen(false)
    setWeightInput("")
    setWeightSaveError("")
    setSelectedPrnHours(null)
    setSuppressNextSlot(false)
  }, [selectedMed?.id])

  const doseDate = recordNow
    ? alignedNow
    : (() => {
        const [y, mo, d] = date.split("-").map(Number)
        const [h, m] = time.split(":").map(Number)
        return new Date(y, mo - 1, d, h, m)
      })()

  useEffect(() => {
    if (selectedPrnHours === null) return
    const chipMs = doseDate.getTime() + selectedPrnHours * 3600000
    if (chipMs <= alignedNow.getTime()) setSelectedPrnHours(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, time, recordNow, nowTick, selectedPrnHours])

  useEffect(() => {
    if (!person?.date_of_birth || !selectedMed || !instanceTimezone) {
      setWeightChecking(false)
      setWeightPromptVisible(false)
      setWeightFormOpen(false)
      setRecentWeight(null)
      return
    }
    const ageY = completedCalendarYears(person.date_of_birth, instanceTimezone)
    if (!Number.isFinite(ageY) || ageY >= 18 || !ruleHasWeightRange(selectedMed.applicable_rule)) {
      setWeightChecking(false)
      setWeightPromptVisible(false)
      setWeightFormOpen(false)
      setRecentWeight(null)
      return
    }

    let cancelled = false
    setWeightChecking(true)
    setRecentWeight(null)
    ;(async () => {
      try {
        const res = await fetch(
          `/api/observations?person_id=${encodeURIComponent(personId)}&type=${encodeURIComponent("Weight")}&limit=1`
        )
        if (!res.ok) throw new Error("Weight fetch failed")
        const rows = (await res.json()) as { value: number; recorded_at: string }[]
        if (cancelled) return
        const w = rows[0]
        // Only GET here — no observation POST; duplicates only if user saves via the form below.
        if (w && Date.now() - new Date(w.recorded_at).getTime() <= NINETY_DAYS_MS) {
          setRecentWeight({ kg: w.value, recordedAt: new Date(w.recorded_at) })
          setWeightPromptVisible(false)
        } else {
          setRecentWeight(null)
          setWeightPromptVisible(true)
        }
      } catch {
        if (!cancelled) {
          setRecentWeight(null)
          setWeightPromptVisible(true)
        }
      } finally {
        if (!cancelled) setWeightChecking(false)
      }
    })()
    return () => { cancelled = true }
  }, [person, selectedMed, personId, instanceTimezone])

  const selectMedication = useCallback((med: MedicationResult) => {
    // Invalidate any in-flight search so its result can't re-open the dropdown.
    searchSeqRef.current++
    setSelectedMed(med)
    setMedicationQuery(med.name)
    setSuggestions([])
    setShowSuggestions(false)
    const cat = effectiveCatalogDosage(med)
    if (cat != null) setDosage(String(cat))
    if (med.dosage_unit) setDosageUnit(med.dosage_unit)
    syncClockFromServer(med.server_now)
    setNowTick(t => t + 1)
  }, [syncClockFromServer])

  useEffect(() => {
    if (!medicationIdFromUrl) return
    const id = parseInt(medicationIdFromUrl, 10)
    if (!Number.isFinite(id)) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/medications?medication_id=${id}&person_id=${encodeURIComponent(personId)}`
        )
        if (!res.ok || cancelled) return
        const listUnknown = await res.json()
        const list: MedicationResult[] = Array.isArray(listUnknown) ? listUnknown : []
        const med = list[0]
        if (med && !cancelled) {
          selectMedication(med)
          if (dosageFromUrl != null && dosageFromUrl.trim() !== "") {
            const d = parseFloat(dosageFromUrl)
            if (Number.isFinite(d) && d > 0) setDosage(String(d))
          }
        }
      } catch {
        /* invalid id or network */
      }
    })()
    return () => { cancelled = true }
  }, [personId, medicationIdFromUrl, dosageFromUrl, selectMedication])

  async function refreshSelectedMedication() {
    const m = selectedMed
    if (!m) return
    setLoadingStatus(true)
    try {
      const res = await fetch(
        `/api/medications?q=${encodeURIComponent(m.name)}&person_id=${personId}`
      )
      const listUnknown = await res.json()
      const list: MedicationResult[] = Array.isArray(listUnknown) ? listUnknown : []
      const updated = list.find(x => x.id === m.id)
      if (updated) {
        setSelectedMed(updated)
        syncClockFromServer(updated.server_now)
        setNowTick(t => t + 1)
      }
    } finally {
      setLoadingStatus(false)
    }
  }

  async function handleRecordWeightSave() {
    const v = parseFloat(weightInput)
    if (!Number.isFinite(v) || v <= 0) {
      setWeightSaveError("Enter a valid weight in kg.")
      return
    }
    setWeightSaving(true)
    setWeightSaveError("")
    let saved = false
    try {
      const res = await fetch("/api/observations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person_id: parseInt(personId, 10),
          observation_type: "Weight",
          value: v,
          unit: "kg",
          recorded_at: new Date().toISOString(),
          comments: "",
        }),
      })
      if (!res.ok) throw new Error("save failed")
      setRecentWeight({ kg: v, recordedAt: new Date() })
      setWeightPromptVisible(false)
      setWeightFormOpen(false)
      setWeightInput("")
      saved = true
    } catch {
      setWeightSaveError("Could not save weight. Please try again.")
    } finally {
      setWeightSaving(false)
    }
    if (saved) await refreshSelectedMedication().catch(() => {})
  }

  async function handleSave() {
    if (!selectedMed && !medicationQuery.trim()) {
      setError("Please select or enter a medication"); return
    }
    setSaving(true); setError("")
    try {
      let medId = selectedMed?.id
      if (!medId && medicationQuery.trim()) {
        const medRes = await fetch("/api/medications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: medicationQuery.trim(),
            default_dosage: dosage ? parseFloat(dosage) : null,
            dosage_unit: dosageUnit
          })
        })
        if (!medRes.ok) throw new Error("Failed to create medication")
        const newMed = await medRes.json()
        medId = newMed.id
      }
      if (!medId) throw new Error("No medication selected")
      const recordedAt = recordNow
        ? alignedNow.toISOString()
        : localDateAndTimeToUtcIso(date, time)
      const recRes = await fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-FC-Tz-Offset": String(new Date().getTimezoneOffset()) },
        body: JSON.stringify({
          person_id: parseInt(personId), medication_id: medId, recorded_at: recordedAt,
          dosage: dosage ? parseFloat(dosage) : null, dosage_unit: dosageUnit, comments,
          suppressNextSlot: suppressNextSlot || undefined,
        })
      })
      if (!recRes.ok) {
        const body = await recRes.json().catch(() => null) as { error?: string } | null
        throw new Error(body?.error || "Failed to save record")
      }
      const recData = await recRes.json() as {
        id: number
        clearedPrnPushRequests?: number
        dosageUnitMismatch?: boolean
      }
      const prnCleared = (recData.clearedPrnPushRequests ?? 0) >= 1
      // A single post-save notice, never two: unit-mismatch subsumes the PRN-cleared copy
      // when both apply, instead of stacking a second dialog after it.
      if (recData.dosageUnitMismatch && selectedMed) {
        setUnitMismatchNotice({
          recordId: recData.id,
          medication: selectedMed,
          recordedUnit: dosageUnit,
          recordedDosage: dosage ? parseFloat(dosage) : null,
          prnCleared,
        })
      } else if (prnCleared) {
        setPrnClearedNoticeOpen(true)
      }
      if (selectedPrnHours !== null) {
        try {
          const notifBlocked = typeof Notification !== "undefined" && Notification.permission === "denied"
          if (!notifBlocked) {
            if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
              const perm = await Notification.requestPermission()
              if (perm !== "granted") { router.push(`/${personId}`); return }
            }
            if ("serviceWorker" in navigator) {
              const reg = await navigator.serviceWorker.register("/sw-push.js")
              await navigator.serviceWorker.ready
              const vapidRes = await fetch("/api/push/vapid-public-key")
              if (vapidRes.ok) {
                const { vapidPublicKey } = await vapidRes.json() as { vapidPublicKey: string }
                const padding = "=".repeat((4 - (vapidPublicKey.length % 4)) % 4)
                const base64 = (vapidPublicKey + padding).replace(/-/g, "+").replace(/_/g, "/")
                const appKey = Uint8Array.from([...atob(base64)].map(c => c.charCodeAt(0))) as Uint8Array<ArrayBuffer>
                const existing = await reg.pushManager.getSubscription()
                const sub = existing ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey })
                const subJson = sub.toJSON()
                await fetch("/api/push/subscribe", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ endpoint: subJson.endpoint, p256dh: subJson.keys?.p256dh, auth: subJson.keys?.auth }),
                })
              }
            }
            await fetch("/api/push/prn-reminder", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ medication_record_id: recData.id, remind_after_hours: selectedPrnHours }),
            })
          }
        } catch {
          // Silent — don't block navigation on push errors
        }
      }
      // A unit-mismatch or PRN-cleared notice (if shown) blocks navigation until dismissed.
      if (!(recData.dosageUnitMismatch && selectedMed) && !prnCleared) {
        router.push(`/${personId}`)
      }
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Failed to save. Please try again.")
      setSaving(false)
    }
  }

  function dismissPrnClearedNotice() {
    setPrnClearedNoticeOpen(false)
    router.push(`/${personId}`)
  }

  function dismissUnitMismatchNotice() {
    setUnitMismatchNotice(null)
    router.push(`/${personId}`)
  }

  async function useRecordedUnitAsDefault() {
    if (!unitMismatchNotice) return
    const med = unitMismatchNotice.medication
    const res = await fetch(`/api/medications/${med.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: med.name,
        default_dosage: med.default_dosage,
        dosage_unit: unitMismatchNotice.recordedUnit,
        notes: med.notes,
        min_age_years: med.min_age_years,
        max_age_years: med.max_age_years,
        group_ids: med.groups.map(g => g.id),
        is_active: true,
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: string } | null
      throw new Error(body?.error || "Could not update the default unit. Please try again.")
    }
    dismissUnitMismatchNotice()
  }

  async function createMedicationVariant(name: string) {
    if (!unitMismatchNotice) return
    const res = await fetch(`/api/records/${unitMismatchNotice.recordId}/create-variant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: string } | null
      throw new Error(body?.error || "Could not create the variant. Please try again.")
    }
    dismissUnitMismatchNotice()
  }

  if (!person) return (
    <div className="flex-1 bg-fc-blue flex items-center justify-center">
      <div className="text-white text-lg">Loading…</div>
    </div>
  )

  const personAgeRaw =
    person.date_of_birth && instanceTimezone
      ? completedCalendarYears(person.date_of_birth, instanceTimezone)
      : NaN
  const personAge = Number.isFinite(personAgeRaw) ? personAgeRaw : null
  const isUnder18 = personAge !== null && personAge < 18

  const rule            = selectedMed?.applicable_rule ?? null
  const totalTaken24h   = selectedMed?.total_taken_24h ?? 0
  const lastDoseAt      = selectedMed?.last_dose_at ? new Date(selectedMed.last_dose_at) : null
  const prnEval = selectedMed
    ? evaluatePrnState(
        {
          rule,
          total24h: totalTaken24h,
          lastDose: lastDoseAt
            ? {
                lastIso: lastDoseAt.toISOString(),
                remindAfterHours: selectedMed.last_dose_remind_after_hours ?? null,
                lastMedName: selectedMed.last_dose_med_name,
              }
            : null,
          oldest24h: selectedMed.oldest_in_window_at,
          lastDosage: selectedMed.last_dosage ?? null,
          catalogDefaultDosage: selectedMed.default_dosage,
        },
        alignedNow,
      )
    : null

  const count24hDoses = ruleMax24hCountsDoses(rule)
  const unitMismatch = rule?.max_quantity_per_24h != null &&
    !count24hDoses &&
    selectedMed != null &&
    dosageUnit !== selectedMed.dosage_unit

  const overQuantityLimit = !unitMismatch && (prnEval?.atCap ?? false)

  const parsedDosage = dosage ? parseFloat(dosage) : 0
  const wouldExceedLimit = !unitMismatch && !overQuantityLimit &&
    rule?.max_quantity_per_24h != null &&
    (count24hDoses
      ? totalTaken24h + 1 > rule.max_quantity_per_24h
      : parsedDosage > 0 && totalTaken24h + parsedDosage > rule.max_quantity_per_24h)

  const catalogDosageUnit = selectedMed?.dosage_unit ?? dosageUnit

  const hasPrnRule = (rule?.min_hours_between ?? 0) > 0

  // Show suppression checkbox when: dose is today AND a scheduled slot exists after the dose time
  const isDoseToday = localDateToIsoYmd(doseDate) === localDateToIsoYmd(alignedNow)
  const nextUpcomingSlot =
    isDoseToday && selectedMed?.schedule_times?.length && selectedMed.schedule_calendar_context
      ? findNextSuppressibleSlot(
          doseDate.getTime(),
          {
            scheduleTimes: selectedMed.schedule_times,
            scheduleFrequency: parseScheduleFrequencyJson(selectedMed.schedule_frequency ?? null),
            scheduleStartDate: selectedMed.schedule_start_date ?? null,
            scheduleEndDate: selectedMed.schedule_end_date ?? null,
          },
          selectedMed.schedule_calendar_context,
        )?.hhmm ?? null
      : null

  const chipHours: number[] = (() => {
    if (!rule || !hasPrnRule) return []
    const minH = rule.min_hours_between
    const maxH = rule.max_hours_between
    if (maxH == null || maxH <= minH) return [minH]
    return [minH, (minH + maxH) / 2, maxH]
  })()

  function chipClockMs(offsetH: number): number {
    return doseDate.getTime() + offsetH * 3600000
  }

  function chipLabel(offsetH: number): string {
    const cd = new Date(chipClockMs(offsetH))
    const hh = String(cd.getHours()).padStart(2, "0")
    const mm = String(cd.getMinutes()).padStart(2, "0")
    return `${formatHm(offsetH)} · ${hh}:${mm}`
  }

  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="Record Medication" />
      <PersonHeader name={person.name} photoUrl={person.photo_url} color={person.color} backHref={`/${personId}`} />
      <main {...mainContentTargetProps} className="flex-1 bg-fc-blue overflow-y-auto fc-scroll">
        <div className="bg-fc-panel m-3 rounded-xl p-4 flex flex-col gap-4">

          <Toggle label="Record Now?" value={recordNow} onChange={setRecordNow} />

          <div className="flex items-center gap-3">
            <label className="font-bold text-gray-800 w-16 shrink-0">Date:</label>
            <input type="date" value={date} disabled={recordNow}
              onChange={e => setDate(e.target.value)}
              className="flex-1 bg-white border border-gray-300 rounded px-3 py-2 text-gray-700
                         disabled:bg-gray-100 disabled:text-gray-400" />
          </div>

          <div className="flex items-center gap-3">
            <label className="font-bold text-gray-800 w-16 shrink-0">Time:</label>
            <input type="time" value={time} disabled={recordNow}
              onChange={e => setTime(e.target.value)}
              className="flex-1 bg-white border border-gray-300 rounded px-3 py-2 text-gray-700
                         disabled:bg-gray-100 disabled:text-gray-400" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-bold text-gray-800">Medication:</label>
              {personAge !== null && (
                <span className="text-xs text-gray-500">Filtered for age {personAge} yrs</span>
              )}
            </div>
            <div className="relative">
              <input type="text" value={medicationQuery} placeholder="Start typing…"
                onChange={e => { setMedicationQuery(e.target.value); setSelectedMed(null) }}
                onFocus={() => !selectedMed && medicationQuery.length > 0 && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-800" />
              {showSuggestions && medicationQuery.trim().length > 0 && !selectedMed && (
                <ul className="absolute z-10 w-full bg-white border border-gray-300 rounded
                               shadow-lg max-h-48 overflow-y-auto">
                  {suggestions.map(med => {
                    const effDosage = effectiveCatalogDosage(med)
                    return (
                    <li key={med.id}>
                      <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => selectMedication(med)}
                        className="w-full text-left px-3 py-2 hover:bg-fc-panel text-gray-800"
                      >
                        <span className="font-medium">{med.name}</span>
                        {effDosage != null && (
                          <span className="text-gray-500 text-sm ml-2">
                            ({effDosage} {med.dosage_unit})
                          </span>
                        )}
                        {med.groups.length > 0 && (
                          <span className="text-gray-400 text-xs ml-2">🧪 {med.groups.map(g => g.name).join(", ")}</span>
                        )}
                      </button>
                    </li>
                  )})}
                  <li>
                    <button
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => { setShowSuggestions(false); setSuggestions([]) }}
                      className={`w-full text-left px-3 py-2 text-fc-blue hover:bg-fc-panel text-sm${suggestions.length > 0 ? " border-t" : ""}`}
                    >
                      Add &quot;{medicationQuery}&quot; as new medication
                    </button>
                  </li>
                </ul>
              )}
            </div>
            {showSuggestions && medicationQuery.trim().length > 0 && !selectedMed && (
              <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                <span className="font-semibold">Adding a new medication type?</span>{" "}
                Ask a <strong>Manager</strong> or <strong>Administrator</strong> to set up dosing frequency rules,
                medication groups, or other catalogue options when you need them.
              </div>
            )}
          </div>

          {selectedMed && weightChecking && (
            <p className="text-xs text-gray-500">Checking recent weight…</p>
          )}

          {selectedMed && !weightChecking && recentWeight && isUnder18 &&
            ruleHasWeightRange(selectedMed.applicable_rule) && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              <div className="font-semibold">Current weight on file</div>
              <p className="text-xs mt-0.5 text-blue-800">
                {recentWeight.kg} kg — recorded {formatWeightRecordedCaption(recentWeight.recordedAt)}
              </p>
            </div>
          )}

          {selectedMed && !weightChecking && weightPromptVisible && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {!weightFormOpen ? (
                <>
                  <div className="font-semibold">⚠️ No recent weight recorded</div>
                  <p className="text-xs mt-1 text-amber-800">
                    Weight-based dosing may be available for this medication.
                  </p>
                  <p className="text-xs mt-1 text-amber-800">
                    You can still save this dose without recording weight — adding weight is optional.
                  </p>
                  <button
                    type="button"
                    onClick={() => { setWeightFormOpen(true); setWeightSaveError("") }}
                    className="mt-2 text-sm font-semibold text-fc-blue hover:underline"
                  >
                    + Record weight
                  </button>
                </>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-gray-800">Weight:</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={weightInput}
                      onChange={e => setWeightInput(e.target.value)}
                      className="w-28 bg-white border border-gray-300 rounded px-3 py-2 text-gray-800"
                      disabled={weightSaving}
                    />
                    <span className="text-gray-700">kg</span>
                    <button
                      type="button"
                      onClick={handleRecordWeightSave}
                      disabled={weightSaving}
                      className="rounded-lg bg-fc-blue px-4 py-2 text-sm font-bold text-white
                                 hover:bg-fc-blue-mid active:bg-fc-blue-dark disabled:opacity-50"
                    >
                      {weightSaving ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setWeightFormOpen(false)
                        setWeightSaveError("")
                      }}
                      disabled={weightSaving}
                      className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-800
                                 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                  {weightSaveError && (
                    <p className="text-xs text-red-600 font-medium">{weightSaveError}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {selectedMed && loadingStatus && (
            <p className="text-xs text-gray-500">Checking dose timing…</p>
          )}
          {selectedMed && !loadingStatus && (
            <DosageStatusPanel
              rule={rule}
              lastDoseAt={lastDoseAt}
              lastDoseMedName={selectedMed.last_dose_med_name}
              lastDoseRemindAfterHours={selectedMed.last_dose_remind_after_hours ?? null}
              lastDosage={selectedMed.last_dosage ?? null}
              catalogDefaultDosage={selectedMed.default_dosage}
              groups={selectedMed.groups}
              totalTaken24h={totalTaken24h}
              dosageUnit={dosageUnit}
              catalogQtyUnit={selectedMed.dosage_unit}
              now={alignedNow}
              oldestInWindowAt={selectedMed.oldest_in_window_at}
            />
          )}

          <div>
            <label className="font-bold text-gray-800 block mb-1">Dosage:</label>
            <div className="flex gap-2">
              <input type="number" value={dosage} onChange={e => setDosage(e.target.value)}
                min="0" step="0.5"
                className="w-24 bg-white border border-gray-300 rounded px-3 py-2 text-gray-800" />
              <select value={dosageUnit} onChange={e => setDosageUnit(e.target.value)}
                className="flex-1 bg-fc-blue text-white font-bold border border-gray-300 rounded px-3 py-2">
                {DOSAGE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            {wouldExceedLimit && (
              <div className="mt-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-xs">
                {count24hDoses ? (
                  <>⚠️ This would exceed the 24-hour limit of {rule!.max_quantity_per_24h} doses ({totalTaken24h} already recorded).</>
                ) : (
                  <>⚠️ This dose would bring total to{" "}
                  {Math.round((totalTaken24h + parsedDosage) * 100) / 100} {catalogDosageUnit} in 24 hours,
                  exceeding the maximum of {rule!.max_quantity_per_24h} {catalogDosageUnit}</>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="font-bold text-gray-800 block mb-1">Comments:</label>
            <textarea value={comments} onChange={e => setComments(e.target.value)} rows={3}
              className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-800 resize-none" />
          </div>

          {error && <p className="text-red-600 text-sm font-medium">{error}</p>}

          {hasPrnRule && chipHours.length > 0 && (
            <div>
              <label className="font-bold text-gray-800 block mb-2 text-sm">
                Remind me when another dose is due
              </label>
              <div className="flex gap-2 flex-wrap">
                {chipHours.map(h => {
                  const past = chipClockMs(h) <= alignedNow.getTime()
                  const active = selectedPrnHours === h
                  return (
                    <button
                      key={h}
                      type="button"
                      disabled={past}
                      onClick={() => setSelectedPrnHours(active ? null : h)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors
                        ${past
                          ? "opacity-40 cursor-not-allowed border-gray-300 bg-gray-100 text-gray-400"
                          : active
                            ? "bg-fc-blue text-white border-fc-blue"
                            : "bg-white text-gray-700 border-gray-300 hover:border-fc-blue hover:text-fc-blue"}`}
                    >
                      {chipLabel(h)}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {nextUpcomingSlot && (
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={suppressNextSlot}
                onChange={e => setSuppressNextSlot(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-fc-blue"
              />
              <span className="text-sm text-gray-700">
                Cancel the {formatSlotTime12h(nextUpcomingSlot)} reminder
              </span>
            </label>
          )}

          <button onClick={handleSave} disabled={saving}
            className="self-end bg-fc-blue text-white font-bold px-6 py-3 rounded-xl
                       hover:bg-fc-blue-mid active:bg-fc-blue-dark disabled:opacity-50 transition-colors">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </main>
      <AppFooter />
      <ConfirmModal
        open={prnClearedNoticeOpen}
        {...confirmCopy.prnPushRequestCleared}
        showCancel={false}
        onConfirm={dismissPrnClearedNotice}
        onCancel={dismissPrnClearedNotice}
      />
      <MedicationUnitMismatchModal
        open={unitMismatchNotice !== null}
        medicationName={unitMismatchNotice?.medication.name ?? ""}
        recordedUnit={unitMismatchNotice?.recordedUnit ?? ""}
        prnCleared={unitMismatchNotice?.prnCleared ?? false}
        isManager={isManager}
        onUseAsDefault={useRecordedUnitAsDefault}
        onCreateVariant={createMedicationVariant}
        onDismiss={dismissUnitMismatchNotice}
      />
    </div>
  )
}
