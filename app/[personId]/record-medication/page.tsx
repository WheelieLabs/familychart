// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import PendingExpectationNotice from "@/components/PendingExpectationNotice"
import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import CollapsibleNotes from "@/components/CollapsibleNotes"
import ConfirmModal, { confirmCopy } from "@/components/ConfirmModal"
import MedicationUnitMismatchModal from "@/components/MedicationUnitMismatchModal"
import RecordDateTime from "@/components/RecordDateTime"
import RecordShell, { RecordLoading } from "@/components/RecordShell"
import SymptomDoseLinkField from "@/components/SymptomDoseLinkField"
import TimingPromptBanner from "@/components/TimingPromptBanner"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import Chip, { ChipGroup } from "@/components/ui/Chip"
import { Input, Select } from "@/components/ui/controls"
import FormField, { FieldGroup, FieldRow } from "@/components/ui/FormField"
import SuggestionList from "@/components/ui/SuggestionList"
import type { FrequencyRule, Person } from "@/lib/domain-types"
import { instantToZonedYmdHm, localDateAndTimeToUtcIso } from "@/lib/datetime"
import { formatDateTime, formatTime, formatWeekdayDate } from "@/lib/date-format"
import { getDisplayTimeZone, setDisplayTimeZone } from "@/lib/display-time-zone"
import { completedCalendarYears } from "@/lib/person/person-age"
import { disabledWhen } from "@/lib/ui/disabled-props"
import { reportProblem } from "@/lib/ui/form-errors"
import { setSaveFlash } from "@/lib/ui/save-flash"
import { closeNotificationsByTag, recordingDeviceHeaders } from "@/lib/push/notification-client"
import { evaluatePrnState } from "@/lib/prn/prn-eval"
import { ruleMax24hIsDoseCount } from "@/lib/frequency-rule"
import { describeTimingPrompt, promptFromTiming, type NeedsPromptTiming } from "@/lib/schedule/dose-timing-prompt"
import type { DoseTiming, PromptAnswer } from "@/lib/schedule/slot-outcomes"
import {
  MEDICATION_ADMINISTERED_BY,
  MEDICATION_ADMINISTERED_BY_LABELS,
  type MedicationAdministeredBy,
} from "@/lib/medication/medication-administered-by"

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


/** `today at 7:46 pm`, `tomorrow at 7:46 pm`, or `Fri 9 Oct at 7:46 pm`, in the household's zone. */
function formatRelativeDayTime(d: Date, now: Date): string {
  const day = instantToZonedYmdHm(d).date
  const time = formatTime(d)
  if (day === instantToZonedYmdHm(now).date) return `today at ${time}`
  if (day === instantToZonedYmdHm(new Date(now.getTime() + 24 * 3600000)).date) return `tomorrow at ${time}`
  return `${formatWeekdayDate(d)} at ${time}`
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
    return <Banner kind="info" lead="No limits">No dosing limits configured for this medication.</Banner>
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
      <Banner kind="error" lead={count24hDoses ? "Maximum doses reached" : "Maximum quantity reached"}>
        <span className="block">
          {count24hDoses ? (
            <>{totalTaken24h} of {rule.max_quantity_per_24h} doses taken in the last 24 hours.</>
          ) : (
            <>{totalTaken24h} of {rule.max_quantity_per_24h} {catalogQtyUnit} taken in the last 24 hours.</>
          )}
        </span>
        {windowClearsAt && (
          <span className="block">Next dose available: {formatRelativeDayTime(windowClearsAt, now)}</span>
        )}
      </Banner>
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
      <Banner kind="warning" lead="Too soon to dose">
        <span className="block">
          Last dose: {lastDoseMedName ?? "unknown"} — {formatDurationHuman(hoursSince!)} ago
        </span>
        {groups.length > 0 && (
          <span className="block">Contains: {groups.map(g => g.name).join(", ")}</span>
        )}
        <span className="block">
          Earliest next dose: in {formatDurationHuman(remaining)} (at {formatTime(nextDoseAt)})
        </span>
        <span className="block">Interval: {intervalLine}</span>
        {unitMismatch && (
          <span className="block">Dose limit tracking unavailable — unit mismatch</span>
        )}
      </Banner>
    )
  }

  if (unitMismatch) {
    return (
      <Banner kind="info" lead="Limit tracking unavailable">
        Unit mismatch (use {catalogQtyUnit} to track the 24h limit).
      </Banner>
    )
  }

  if (!lastDoseAt) {
    return <Banner kind="info" lead="Dosing guide">{ruleInfoText(rule, catalogQtyUnit)}</Banner>
  }

  return (
    <Banner kind="success" lead="Safe to give">
      Last given {formatDurationHuman(hoursSince!)} ago.
      {rule.max_quantity_per_24h != null && (
        count24hDoses ? (
          <> {totalTaken24h} of {rule.max_quantity_per_24h} doses used in the last 24 hours.</>
        ) : (
          <> {totalTaken24h} of {rule.max_quantity_per_24h} {catalogQtyUnit} used in the last 24 hours.</>
        )
      )}
    </Banner>
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
  const { date: todayDate, time: nowTime } = instantToZonedYmdHm(new Date())
  const [date, setDate]                   = useState(todayDate)
  const [time, setTime]                   = useState(nowTime)

  const [medicationQuery, setMedicationQuery] = useState("")
  const [medicationInvalid, setMedicationInvalid] = useState(false)
  const [suggestions, setSuggestions]     = useState<MedicationResult[]>([])
  const [selectedMed, setSelectedMed]     = useState<MedicationResult | null>(null)
  const [dosage, setDosage]               = useState("")
  const [dosageUnit, setDosageUnit]       = useState("Tabs")
  const [comments, setComments]           = useState("")
  const [administeredBy, setAdministeredBy] = useState<MedicationAdministeredBy>("me")
  const [linkedSymptomIds, setLinkedSymptomIds] = useState<number[]>([])
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
  const [instanceTimezone, setInstanceTimezone]   = useState<string | null>(null)
  // Until the instance timezone arrives the date and time default to UTC, so re-seed them once it does.
  // They are only shown while "Record now" is on, so this never overwrites something the person typed.
  useEffect(() => {
    if (!instanceTimezone || !recordNow) return
    const now = instantToZonedYmdHm(new Date(), instanceTimezone)
    setDate(now.date)
    setTime(now.time)
  }, [instanceTimezone]) // eslint-disable-line react-hooks/exhaustive-deps -- seeds once per zone
  const [prnClearedNoticeOpen, setPrnClearedNoticeOpen] = useState(false)
  const [isManager, setIsManager] = useState(false)
  // Set after Save when the dose fell outside every slot window; the dose is already saved.
  const [timingPrompt, setTimingPrompt] = useState<{ recordId: number; timing: NeedsPromptTiming } | null>(null)
  const [timingAnswering, setTimingAnswering] = useState<PromptAnswer | null>(null)
  const [timingError, setTimingError] = useState("")
  const timingPromptRef = useRef<HTMLDivElement>(null)
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
          setDisplayTimeZone(me.instanceTimezone)
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
  }, [selectedMed?.id])

  const doseDate = recordNow
    ? alignedNow
    : (() => {
        try { return new Date(localDateAndTimeToUtcIso(date, time, getDisplayTimeZone())) } catch { return alignedNow }
      })()

  // Symptoms are offered by the dose's local day, so a midday stand-in keeps the candidate fetch stable.
  const linkDay = instantToZonedYmdHm(doseDate).date
  const linkCandidateIso = useMemo(() => {
    try { return localDateAndTimeToUtcIso(linkDay, "12:00") } catch { return new Date().toISOString() }
  }, [linkDay])

  useEffect(() => {
    if (selectedPrnHours === null) return
    const chipMs = doseDate.getTime() + selectedPrnHours * 3600000
    if (chipMs <= alignedNow.getTime()) setSelectedPrnHours(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- clear expired PRN chip when dose time or tick changes
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
      setError("Please select or enter a medication")
      setMedicationInvalid(true)
      reportProblem("medication-query", "Medication")
      return
    }
    setMedicationInvalid(false)
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
            dosage_unit: dosageUnit,
            person_id: parseInt(personId),
          })
        })
        if (!medRes.ok) {
          const medBody = await medRes.json().catch(() => null) as { error?: string } | null
          throw new Error(medBody?.error || "Failed to create medication")
        }
        const newMed = await medRes.json()
        medId = newMed.id
      }
      if (!medId) throw new Error("No medication selected")
      const recordedAt = recordNow
        ? alignedNow.toISOString()
        : localDateAndTimeToUtcIso(date, time)
      const recRes = await fetch("/api/records", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-FC-Tz-Offset": String(new Date().getTimezoneOffset()),
          ...(await recordingDeviceHeaders()),
        },
        body: JSON.stringify({
          person_id: parseInt(personId), medication_id: medId, recorded_at: recordedAt,
          dosage: dosage ? parseFloat(dosage) : null, dosage_unit: dosageUnit, comments,
          administered_by: administeredBy,
          linked_symptom_ids: linkedSymptomIds.length > 0 ? linkedSymptomIds : undefined,
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
        timing?: DoseTiming
        closeNotificationTag?: string | null
      }
      // A dose attached to a slot closes this device's own reminder; the other devices get a push.
      await closeNotificationsByTag(recData.closeNotificationTag)
      setSaveFlash(
        [selectedMed?.name ?? medicationQuery.trim(), dosage ? `${dosage} ${dosageUnit}` : ""].filter(Boolean).join(" "),
      )
      const prnCleared = (recData.clearedPrnPushRequests ?? 0) >= 1
      const timing = promptFromTiming(recData.timing)
      if (timing) setTimingPrompt({ recordId: recData.id, timing })
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
              if (perm !== "granted") { if (!timing) router.push(`/${personId}`); return }
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
      // A unit-mismatch or PRN-cleared notice (if shown) blocks navigation until dismissed, and so does
      // the timing prompt until it is answered.
      if (!(recData.dosageUnitMismatch && selectedMed) && !prnCleared && !timing) {
        router.push(`/${personId}`)
      }
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Failed to save. Please try again.")
      setSaving(false)
    }
  }

  function dismissPrnClearedNotice() {
    setPrnClearedNoticeOpen(false)
    if (!timingPrompt) router.push(`/${personId}`)
  }

  function dismissUnitMismatchNotice() {
    setUnitMismatchNotice(null)
    if (!timingPrompt) router.push(`/${personId}`)
  }

  // The dose is already saved; leaving without an answer keeps it as an extra dose.
  async function answerTiming(answer: PromptAnswer) {
    if (!timingPrompt) return
    setTimingAnswering(answer)
    setTimingError("")
    try {
      const res = await fetch(`/api/records/${timingPrompt.recordId}/timing`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-FC-Tz-Offset": String(new Date().getTimezoneOffset()),
          ...(await recordingDeviceHeaders()),
        },
        body: JSON.stringify({ answer }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(body?.error || "Could not save your answer")
      }
      // Late or Early attaches the dose to a slot, which clears this device's reminder.
      const answered = await res.json().catch(() => null) as { closeNotificationTag?: string | null } | null
      await closeNotificationsByTag(answered?.closeNotificationTag)
      router.push(`/${personId}`)
    } catch (e) {
      setTimingError(e instanceof Error && e.message ? e.message : "Could not save your answer. Please try again.")
      setTimingAnswering(null)
    }
  }

  // The Save button goes away once the prompt appears, so move focus to the prompt rather than lose it.
  useEffect(() => {
    if (timingPrompt && !unitMismatchNotice && !prnClearedNoticeOpen) timingPromptRef.current?.focus()
  }, [timingPrompt, unitMismatchNotice, prnClearedNoticeOpen])

  async function applyRecordedUnitAsDefault() {
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

  if (!person) return <RecordLoading title="Record Medication" />

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
    return `${formatHm(offsetH)} · ${formatTime(new Date(chipClockMs(offsetH)))}`
  }
  return (
    <>
      <RecordShell title="Record Medication" person={person}>
        <div className="fc-form">
          <PendingExpectationNotice personId={parseInt(personId, 10)} medicationId={selectedMed?.id ?? null} />

          <RecordDateTime
            recordNow={recordNow}
            onRecordNowChange={setRecordNow}
            date={date}
            onDateChange={setDate}
            time={time}
            onTimeChange={setTime}
            timeZone={instanceTimezone ?? undefined}
          />

          <FormField
            id="medication-query"
            label="Medication"
            hint={personAge !== null ? `Filtered for age ${personAge} yrs` : undefined}
            error={medicationInvalid ? "Select or enter a medication." : undefined}
          >
            <div
              className="fc-suggest-wrap"
              onBlur={e => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setShowSuggestions(false)
              }}
            >
              <Input
                type="text"
                value={medicationQuery}
                placeholder="Start typing…"
                autoComplete="off"
                onChange={e => { setMedicationQuery(e.target.value); setSelectedMed(null) }}
                onFocus={() => !selectedMed && medicationQuery.length > 0 && setShowSuggestions(true)}
              />
              {showSuggestions && medicationQuery.trim().length > 0 && !selectedMed && (
                <SuggestionList
                  items={[
                    ...suggestions.map(med => {
                      const effDosage = effectiveCatalogDosage(med)
                      return {
                        key: med.id,
                        onSelect: () => selectMedication(med),
                        label: (
                          <>
                            <span className="fc-suggest__name">{med.name}</span>
                            {effDosage != null && (
                              <span className="fc-suggest__detail">({effDosage} {med.dosage_unit})</span>
                            )}
                            {med.groups.length > 0 && (
                              <span className="fc-suggest__detail">🧪 {med.groups.map(g => g.name).join(", ")}</span>
                            )}
                          </>
                        ),
                      }
                    }),
                    {
                      key: "new",
                      onSelect: () => { setShowSuggestions(false); setSuggestions([]) },
                      label: <>Add &quot;{medicationQuery}&quot; as new medication</>,
                    },
                  ]}
                />
              )}
            </div>
          </FormField>
          {showSuggestions && medicationQuery.trim().length > 0 && !selectedMed && (
            <Banner kind="info" lead="New medication">
              Ask a Manager or Administrator to set up dosing frequency rules, medication groups or other
              catalogue options when you need them.
            </Banner>
          )}

          {selectedMed && weightChecking && (
            <p className="fc-field__hint">Checking recent weight…</p>
          )}

          {selectedMed && !weightChecking && recentWeight && isUnder18 &&
            ruleHasWeightRange(selectedMed.applicable_rule) && (
            <Banner kind="info" lead="Current weight on file">
              {recentWeight.kg} kg, recorded {formatDateTime(recentWeight.recordedAt)}
            </Banner>
          )}

          {selectedMed && !weightChecking && weightPromptVisible && (
            <>
              <Banner kind="warning" lead="No recent weight recorded">
                Weight-based dosing may be available for this medication. You can still save this dose without
                recording weight; adding weight is optional.
              </Banner>
              {!weightFormOpen ? (
                <div>
                  <Button variant="quiet" onClick={() => { setWeightFormOpen(true); setWeightSaveError("") }}>
                    + Record weight
                  </Button>
                </div>
              ) : (
                <div className="fc-subform">
                  <FormField label="Weight (kg)" error={weightSaveError || undefined}>
                    <Input
                      type="number"
                      min="0"
                      step="0.1"
                      value={weightInput}
                      onChange={e => setWeightInput(e.target.value)}
                      disabled={weightSaving}
                    />
                  </FormField>
                  <div className="fc-form-actions">
                    <Button onClick={handleRecordWeightSave} pending={weightSaving}>Save weight</Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setWeightFormOpen(false)
                        setWeightSaveError("")
                      }}
                      {...disabledWhen(weightSaving && "Saving the weight…")}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {selectedMed && loadingStatus && (
            <p className="fc-field__hint">Checking dose timing…</p>
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

          <FormField label="Dosage" optional>
            <FieldRow>
              <Input type="number" value={dosage} onChange={e => setDosage(e.target.value)} min="0" step="0.5" />
              <Select aria-label="Unit" value={dosageUnit} onChange={e => setDosageUnit(e.target.value)}>
                {DOSAGE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </Select>
            </FieldRow>
          </FormField>
          {wouldExceedLimit && (
            <Banner kind="warning" lead="Over the limit">
              {count24hDoses ? (
                <>This would exceed the 24-hour limit of {rule!.max_quantity_per_24h} doses ({totalTaken24h} already recorded).</>
              ) : (
                <>This dose would bring the total to{" "}
                {Math.round((totalTaken24h + parsedDosage) * 100) / 100} {catalogDosageUnit} in 24 hours,
                exceeding the maximum of {rule!.max_quantity_per_24h} {catalogDosageUnit}.</>
              )}
            </Banner>
          )}

          <ChipGroup
            legend="Administered by"
            options={MEDICATION_ADMINISTERED_BY.map(v => ({ value: v, label: MEDICATION_ADMINISTERED_BY_LABELS[v] }))}
            value={administeredBy}
            onChange={setAdministeredBy}
          />

          <SymptomDoseLinkField
            kind="dose"
            personId={personId}
            recordedAtIso={linkCandidateIso}
            selected={linkedSymptomIds}
            onChange={setLinkedSymptomIds}
          />

          <CollapsibleNotes noun="comment" value={comments} onChange={setComments} />

          {error && <Banner kind="error">{error}</Banner>}

          {hasPrnRule && chipHours.length > 0 && (
            <FieldGroup
              label="Remind me when another dose is due"
              optional
              hint="Times that have already passed cannot be chosen."
            >
              <div className="fc-chip-set__chips">
                {chipHours.map(h => {
                  const past = chipClockMs(h) <= alignedNow.getTime()
                  return (
                    <Chip
                      key={h}
                      kind="toggle"
                      disabled={past}
                      pressed={selectedPrnHours === h}
                      onPressedChange={on => setSelectedPrnHours(on ? h : null)}
                    >
                      {chipLabel(h)}
                    </Chip>
                  )
                })}
              </div>
            </FieldGroup>
          )}

          {timingPrompt ? (
            <div ref={timingPromptRef} role="group" aria-label="Which dose was this?" tabIndex={-1}>
              <TimingPromptBanner
                timing={timingPrompt.timing}
                answering={timingAnswering}
                error={timingError}
                onAnswer={answerTiming}
              />
            </div>
          ) : (
            <div className="fc-actions-end">
              <Button onClick={handleSave} pending={saving}>Save</Button>
            </div>
          )}
        </div>
      </RecordShell>
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
        onUseAsDefault={applyRecordedUnitAsDefault}
        onCreateVariant={createMedicationVariant}
        onDismiss={dismissUnitMismatchNotice}
      />
    </>
  )
}
