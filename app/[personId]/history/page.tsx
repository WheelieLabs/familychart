// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useParams } from "next/navigation"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import { FcTabBar, type FcTabItem } from "@/components/FcTabBar"
import { PersonHeader } from "@/components/AppHeader"
import LineChart from "@/components/LineChart"
import HydrationBarChart from "@/components/HydrationBarChart"
import ConfirmModal, { confirmCopy, type ConfirmVariant } from "@/components/ConfirmModal"
import { EntityRowDeleteButton, EntityRowEditButton } from "@/components/EntityRowActions"
import type { ObservationGoal, ObservationTypeConfig, Person } from "@/lib/domain-types"
import { addCalendarDaysToIsoYmd, localDateToIsoYmd } from "@/lib/datetime"
import { formatStaleThresholdHours, isStaleReading } from "@/lib/observation/observation-staleness"
import { formatHydration } from "@/lib/format"
import { dashboardScheduleHeaders } from "@/lib/dashboard/dashboard-client-context"
import { mainContentTargetProps } from "@/lib/a11y"
import type { MeasurementSystem } from "@/lib/settings/registry"
import { groupBpRows } from "@/lib/blood-pressure-pairing"
import { MEDICATION_DOSAGE_UNITS } from "@/lib/medication/medication-units"
import { OBSERVATION_UI_TYPES } from "@/lib/observation/observation-types"
import {
  fmtAU as fmtMedAU,
  useMedicationHistory,
  type MedRecord,
} from "@/lib/medication/medication-history"
import {
  buildBpTableRows,
  chartSeriesForObs,
  convertGoalValue,
  displayObsValue,
  fmtAU as fmtObsAU,
  formatBpSingle,
  isPaginatedObsType,
  observationHasChart,
  OBS_HISTORY_CHART_TYPES,
  useObservationHistory,
  type BpDetailRow,
  type ObsRecord,
  type ObsSummary,
} from "@/lib/observation/observation-history"

type MergedDateItem =
  | { kind: "med"; entry: MedDateEntry }
  | { kind: "obs"; entry: ObsDateEntry }
  | {
      kind: "bp_pair"
      sys: ObsRecord
      dia: ObsRecord
      recorded_at: string
      comments: string | null
    }

type MedDateEntry = MedRecord & { _type: "med" }
type ObsDateEntry = ObsRecord & { _type: "obs" }
type DateEntry = MedDateEntry | ObsDateEntry

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

function fmtTimeAU(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours()
  const hour = h % 12 || 12
  return `${hour}:${d.getMinutes().toString().padStart(2,"0")} ${h >= 12 ? "PM" : "AM"}`
}

function fmtDateLabel(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

function dateKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function daysAgo(n: number, fromYmd: string): string {
  return addCalendarDaysToIsoYmd(fromYmd, -n)
}

/** Refreshes on tab focus/visibility so end-date defaults stay current across midnight. */
function useRefreshingLocalToday(): string {
  const [today, setToday] = useState(() => localDateToIsoYmd(new Date()))
  useEffect(() => {
    const bump = () => {
      const next = localDateToIsoYmd(new Date())
      setToday(prev => (prev === next ? prev : next))
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") bump()
    }
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("focus", bump)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("focus", bump)
    }
  }, [])
  return today
}

const DATE_PAGE_SIZE = 50

const DOSAGE_UNITS = [...MEDICATION_DOSAGE_UNITS]

const OBS_UNITS: Record<string, string[]> = {
  ...Object.fromEntries(OBSERVATION_UI_TYPES.map(t => [t.label, [...t.units]])),
  "Blood Pressure Systolic": ["mmHg"],
  "Blood Pressure Diastolic": ["mmHg"],
}

function mergeBpDateEntries(entries: DateEntry[]): MergedDateItem[] {
  const meds = entries.filter((e): e is MedDateEntry => e._type === "med")
  const bpObs = entries.filter(
    (e): e is ObsDateEntry => e._type === "obs" && e.observation_type === "Blood Pressure"
  )
  const otherObs = entries.filter(
    (e): e is ObsDateEntry => e._type === "obs" && e.observation_type !== "Blood Pressure"
  )

  const out: MergedDateItem[] = []

  for (const g of groupBpRows(bpObs, "detail")) {
    if (g.kind === "pair") {
      out.push({ kind: "bp_pair", sys: g.sys, dia: g.dia, recorded_at: g.recorded_at, comments: g.comments })
    } else {
      out.push({ kind: "obs", entry: g.record })
    }
  }
  for (const m of meds) out.push({ kind: "med", entry: m })
  for (const o of otherObs) out.push({ kind: "obs", entry: o })

  out.sort((a, b) => {
    const ta =
      a.kind === "bp_pair"
        ? new Date(a.recorded_at).getTime()
        : new Date(a.entry.recorded_at).getTime()
    const tb =
      b.kind === "bp_pair"
        ? new Date(b.recorded_at).getTime()
        : new Date(b.entry.recorded_at).getTime()
    return tb - ta
  })

  return out
}

function mergedItemTime(m: MergedDateItem): string {
  if (m.kind === "bp_pair") return m.recorded_at
  return m.entry.recorded_at
}

function splitDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  const y = d.getFullYear()
  const mo = d.getMonth() + 1
  const day = d.getDate()
  return {
    date: `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
  }
}

type HistoryTab = "medication" | "observations" | "date"

const HISTORY_TABS: FcTabItem<HistoryTab>[] = [
  { value: "medication", label: "Medication" },
  { value: "observations", label: "Observations" },
  { value: "date", label: "Date" },
]

export default function HistoryPage() {
  const params = useParams()
  const personId = params.personId as string
  const todayYmd = useRefreshingLocalToday()
  const prevTodayRef = useRef(todayYmd)

  const [person, setPerson]     = useState<Person | null>(null)
  const [tab, setTab]           = useState<HistoryTab>("medication")
  const [canDelete, setCanDelete] = useState(false)

  const med = useMedicationHistory({ personId, tab, todayYmd })
  const {
    summaries: medSummaries,
    summaryLoading: medSummaryLoading,
    selectedMed,
    selectMed,
    records: medRecords,
    recordsLoading: medRecordsLoading,
    cursor: medCursor,
    loadingMore: medLoadingMore,
    from: medFrom,
    setFrom: setMedFrom,
    to: medTo,
    setTo: setMedTo,
    loadRecords: loadMedRecords,
    loadMoreRecords: loadMoreMedRecords,
  } = med

  const obs = useObservationHistory({ personId, tab, todayYmd })
  const {
    summaries: obsSummaries,
    typeConfigs: obsTypeConfigs,
    summaryLoading: obsSummaryLoading,
    selectedObs,
    selectObs,
    records: obsRecords,
    recordsLoading: obsRecordsLoading,
    cursor: obsCursor,
    loadingMore: obsLoadingMore,
    chartData: obsChartData,
    chartLoading: obsChartLoading,
    from: obsFrom,
    setFrom: setObsFrom,
    to: obsTo,
    setTo: setObsTo,
    applyPreset: applyObsPreset,
    loadRecords: loadObsRecords,
    loadMoreRecords: loadMoreObsRecords,
    loadChartData: loadObsChartData,
  } = obs

  const [obsGoal, setObsGoal] = useState<ObservationGoal | null>(null)
  // null = loading/not fetched, "error" = fetch failed (fall back to summary value), number = today's total
  const [hydrationTodayMl, setHydrationTodayMl] = useState<number | "error" | null>(null)
  const [measurementSystem, setMeasurementSystem] = useState<MeasurementSystem>("metric")

  // Date tab
  const [dateFrom, setDateFrom] = useState(() => daysAgo(7, localDateToIsoYmd(new Date())))
  const [dateTo, setDateTo]     = useState(() => localDateToIsoYmd(new Date()))
  const [dateEntries, setDateEntries] = useState<DateEntry[]>([])
  const [dateLoading, setDateLoading] = useState(false)
  const [dateVisibleCount, setDateVisibleCount] = useState(DATE_PAGE_SIZE)

  const [editingMedId, setEditingMedId] = useState<number | null>(null)
  const [medDraft, setMedDraft] = useState<{ date: string; time: string; dosage: string; dosage_unit: string; comments: string } | null>(null)
  const [editingObsId, setEditingObsId] = useState<number | null>(null)
  const [obsDraft, setObsDraft] = useState<{ date: string; time: string; value: string; unit: string; comments: string; observation_type: string } | null>(null)
  const [editingBpSession, setEditingBpSession] = useState<string | null>(null)
  const [bpDraft, setBpDraft] = useState<{ date: string; time: string; systolic: string; diastolic: string; comments: string; sysId: number; diaId: number | null } | null>(null)
  const [prnClearedNoticeOpen, setPrnClearedNoticeOpen] = useState(false)

  const [confirmDlg, setConfirmDlg] = useState<null | {
    title: string
    message: string
    detail?: string
    variant: ConfirmVariant
    confirmLabel?: string
    cancelLabel?: string
    onConfirm: () => void | Promise<void>
  }>(null)

  useEffect(() => {
    const prev = prevTodayRef.current
    if (todayYmd !== prev) {
      setDateTo(t => (t === prev ? todayYmd : t))
      prevTodayRef.current = todayYmd
    }
  }, [todayYmd])

  useEffect(() => {
    fetch(`/api/people/${personId}`).then(r => r.json()).then(setPerson)
    fetch("/api/me").then(r => r.json()).then((me: { role: string | null; measurementSystem?: MeasurementSystem }) => {
      setCanDelete(
        me.role === "admin" || me.role === "manager" || me.role === "readwrite"
      )
      if (me.measurementSystem === "metric" || me.measurementSystem === "imperial") {
        setMeasurementSystem(me.measurementSystem)
      }
    })
  }, [personId])

  // Hydration day-total — only fires when Hydration appears in the summary response
  useEffect(() => {
    const hasHydration = obsSummaries.some(s => s.observation_type === "Hydration")
    if (!hasHydration) { setHydrationTodayMl(null); return }
    setHydrationTodayMl(null)
    fetch(`/api/observations/hydration-today?person_id=${personId}`, {
      headers: dashboardScheduleHeaders(),
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: { total_ml: number; goal_ml: number | null }) => setHydrationTodayMl(data.total_ml))
      .catch(() => setHydrationTodayMl("error"))
  }, [obsSummaries, personId])

  // Fetch goal for the selected observation type
  useEffect(() => {
    if (!selectedObs) { setObsGoal(null); return }
    fetch(
      `/api/observation-goals?person_id=${personId}&observation_type=${encodeURIComponent(selectedObs.observation_type)}`
    )
      .then(r => r.ok ? r.json() : null)
      .then((g: ObservationGoal | null) => setObsGoal(g))
      .catch(() => setObsGoal(null))
  }, [selectedObs, personId])

  // Date tab entries
  const loadDateEntries = useCallback(async () => {
    if (tab !== "date") return
    setDateLoading(true)
    try {
      const [recs, obsRows] = await Promise.all([
        fetch(`/api/records?person_id=${personId}&from=${dateFrom}&to=${dateTo}`, {
          headers: dashboardScheduleHeaders(),
        }).then(r => r.json()),
        fetch(`/api/observations?person_id=${personId}&from=${dateFrom}&to=${dateTo}`, {
          headers: dashboardScheduleHeaders(),
        }).then(r => r.json()),
      ])
      const merged: DateEntry[] = [
        ...(recs as MedRecord[]).map(r => ({ ...r, _type: "med" as const })),
        ...(obsRows as ObsRecord[]).map(o => ({ ...o, _type: "obs" as const })),
      ].sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())
      setDateEntries(merged)
    } finally { setDateLoading(false) }
  }, [personId, tab, dateFrom, dateTo])

  useEffect(() => { loadDateEntries() }, [loadDateEntries])

  useEffect(() => { setDateVisibleCount(DATE_PAGE_SIZE) }, [personId, tab, dateFrom, dateTo])

  const mergedDateEntries = useMemo(
    () => (tab === "date" ? mergeBpDateEntries(dateEntries) : []),
    [tab, dateEntries]
  )

  const visibleDateEntries = mergedDateEntries.slice(0, dateVisibleCount)

  const obsConfigByLower = useMemo(() => {
    const m = new Map<string, ObservationTypeConfig>()
    for (const c of obsTypeConfigs) {
      m.set(c.observation_type.trim().toLowerCase(), c)
    }
    return m
  }, [obsTypeConfigs])

  function deleteMedRecord(id: number) {
    setConfirmDlg({
      ...confirmCopy.deleteMedicationRecord,
      onConfirm: async () => {
        await med.deleteRecord(id)
        setConfirmDlg(null)
      },
    })
  }

  function deleteObsRecord(id: number) {
    setConfirmDlg({
      ...confirmCopy.deleteObservation,
      onConfirm: async () => {
        await obs.deleteRecord(id)
        setConfirmDlg(null)
      },
    })
  }

  function deleteDateEntry(type: "med" | "obs", id: number) {
    const copy = type === "med" ? confirmCopy.deleteMedicationRecord : confirmCopy.deleteObservation
    setConfirmDlg({
      ...copy,
      onConfirm: async () => {
        if (type === "med") await fetch(`/api/records?id=${id}`, { method: "DELETE" })
        else await fetch(`/api/observations?id=${id}`, { method: "DELETE" })
        loadDateEntries()
        setConfirmDlg(null)
      },
    })
  }

  function startEditMed(r: MedRecord) {
    const { date, time } = splitDateTime(r.recorded_at)
    setEditingMedId(r.id)
    setMedDraft({ date, time, dosage: r.dosage != null ? String(r.dosage) : "", dosage_unit: r.dosage_unit ?? "Tabs", comments: r.comments ?? "" })
  }

  async function saveMedRecord() {
    if (!editingMedId || !medDraft) return
    const { clearedPrnPushRequests } = await med.saveRecord(editingMedId, medDraft)
    if (clearedPrnPushRequests >= 1) setPrnClearedNoticeOpen(true)
    setEditingMedId(null); setMedDraft(null)
    loadDateEntries()
  }

  function startEditObs(r: ObsRecord) {
    const { date, time } = splitDateTime(r.recorded_at)
    setEditingObsId(r.id)
    setObsDraft({ date, time, value: String(r.value), unit: r.unit, comments: r.comments ?? "", observation_type: r.observation_type })
  }

  async function saveObsRecord() {
    if (!editingObsId || !obsDraft) return
    await obs.saveRecord(editingObsId, obsDraft)
    setEditingObsId(null); setObsDraft(null)
    loadDateEntries()
  }

  function startEditBp(pair: Extract<BpDetailRow, { kind: "pair" }>) {
    const { date, time } = splitDateTime(pair.recorded_at)
    setEditingBpSession(pair.session_id)
    setBpDraft({
      date, time,
      systolic: String(pair.sys.value),
      diastolic: String(pair.dia.value),
      comments: pair.sys.comments ?? pair.dia.comments ?? "",
      sysId: pair.sys.id,
      diaId: pair.dia.id,
    })
  }

  async function saveBpPair() {
    if (!bpDraft) return
    await obs.saveBpPair(bpDraft)
    setEditingBpSession(null); setBpDraft(null)
    loadDateEntries()
  }

  function deleteBpPair(sysId: number | null, diaId: number | null) {
    setConfirmDlg({
      ...confirmCopy.deleteBloodPressureReading,
      onConfirm: async () => {
        await obs.deleteBpPair(sysId, diaId)
        loadDateEntries()
        setConfirmDlg(null)
      },
    })
  }

  if (!person) return (
    <div className="flex flex-col flex-1">
      <div className="flex-1 bg-fc-blue flex items-center justify-center">
        <div className="text-white">Loading…</div>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <AppHeader title="History" />
      <PersonHeader name={person.name} photoUrl={person.photo_url} color={person.color} backHref={`/${personId}`} />

      <FcTabBar tabs={HISTORY_TABS} active={tab} onSelect={setTab} />

      <main
        {...mainContentTargetProps}
        className={
          "flex-1 min-h-0 bg-fc-blue px-3 py-2 flex flex-col " +
          (tab === "observations" && selectedObs
            ? "overflow-y-auto lg:overflow-hidden"
            : "overflow-y-auto fc-scroll")
        }
      >

        {/* ── MEDICATION TAB ── */}

        {tab === "medication" && !selectedMed && (
          <>
            {medSummaryLoading && <div className="text-white text-center py-8">Loading…</div>}
            {!medSummaryLoading && medSummaries.length === 0 && (
              <p className="text-white text-center py-8">No medications recorded yet.</p>
            )}
            {!medSummaryLoading && medSummaries.length > 0 && (
              <ul className="flex flex-col gap-2">
                {medSummaries.map(m => (
                  <li key={m.id}>
                    <button onClick={() => selectMed(m)}
                      className="w-full bg-white/10 hover:bg-white/20 active:bg-white/30 rounded-xl px-4 py-3 text-left flex justify-between items-center gap-2 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-bold text-base">{m.name}</div>
                        <div className="text-white text-sm mt-0.5">Last recorded: {fmtMedAU(m.last_recorded)}</div>
                        <div className="text-white text-sm">{m.total_doses} dose{m.total_doses === 1 ? "" : "s"} recorded</div>
                      </div>
                      <span className="text-white text-2xl leading-none shrink-0">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === "medication" && selectedMed && (
          <>
            <button onClick={() => selectMed(null)}
              className="flex items-center gap-1 text-white hover:text-white font-semibold mb-3 transition-colors">
              <span className="text-xl leading-none">‹</span>
              <span>{selectedMed.name}</span>
            </button>

            <div className="flex gap-2 items-center mb-3">
              <input type="date" value={medFrom} onChange={e => setMedFrom(e.target.value)}
                className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1 text-gray-800" />
              <span className="text-white text-xs">→</span>
              <input type="date" value={medTo} onChange={e => setMedTo(e.target.value)}
                className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1 text-gray-800" />
              <button onClick={loadMedRecords}
                className="bg-fc-blue-dark text-white text-xs px-3 py-1 rounded font-bold">Go</button>
            </div>

            {medRecordsLoading && <div className="text-white text-center py-8">Loading…</div>}

            {!medRecordsLoading && (
              <>
                <p className="text-white text-xs mb-2">
                  {medRecords.length} record{medRecords.length === 1 ? "" : "s"} in selected period
                </p>
                {medRecords.length === 0
                  ? <p className="text-white text-center py-8">No records in this period.</p>
                  : <ul className="flex flex-col gap-2">
                      {medRecords.map(r => {
                        if (editingMedId === r.id && medDraft) return (
                          <li key={r.id} className="bg-white/10 rounded-xl px-4 py-3 flex flex-col gap-2">
                            <div className="flex gap-2">
                              <input type="date" value={medDraft.date} onChange={e => setMedDraft(d => ({ ...d!, date: e.target.value }))}
                                className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                              <input type="time" value={medDraft.time} onChange={e => setMedDraft(d => ({ ...d!, time: e.target.value }))}
                                className="w-24 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                            </div>
                            <div className="flex gap-2">
                              <input type="number" value={medDraft.dosage} min="0" step="0.1" placeholder="Dosage"
                                onChange={e => setMedDraft(d => ({ ...d!, dosage: e.target.value }))}
                                className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                              <select value={medDraft.dosage_unit} onChange={e => setMedDraft(d => ({ ...d!, dosage_unit: e.target.value }))}
                                className="text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800">
                                {DOSAGE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                              </select>
                            </div>
                            <input type="text" value={medDraft.comments} placeholder="Comments"
                              onChange={e => setMedDraft(d => ({ ...d!, comments: e.target.value }))}
                              className="text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                            <div className="flex gap-2 justify-end">
                              <button onClick={() => { setEditingMedId(null); setMedDraft(null) }}
                                className="text-white text-xs px-3 py-1.5 rounded border border-white/20 hover:bg-white/10">Cancel</button>
                              <button onClick={saveMedRecord}
                                className="bg-fc-blue-dark text-white text-xs px-4 py-1.5 rounded font-bold hover:bg-fc-blue-mid">Save</button>
                            </div>
                          </li>
                        )
                        return (
                          <li key={r.id} className="bg-white/10 rounded-xl px-4 py-3">
                            <div className="flex justify-between items-start gap-2">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                  <span className="text-white text-sm">{fmtMedAU(r.recorded_at)}</span>
                                  {r.scheduled_time != null && r.scheduled_time !== "" && (
                                    <span className="text-white text-xs">
                                      Scheduled: {r.scheduled_time}
                                      {r.scheduled_late === true && (
                                        <span className="ml-2 inline-block rounded-md border border-amber-400/60 bg-amber-500/20 px-1.5 py-0.5 text-amber-100 font-semibold">
                                          Late (over 30 min after slot)
                                        </span>
                                      )}
                                    </span>
                                  )}
                                </div>
                                {r.dosage != null && (
                                  <div className="text-white text-sm font-semibold mt-0.5">
                                    {r.dosage} {r.dosage_unit}
                                  </div>
                                )}
                              </div>
                              {canDelete && (
                                <div className="flex gap-3 items-center shrink-0">
                                  <EntityRowEditButton onClick={() => startEditMed(r)} title="Edit record" />
                                  <EntityRowDeleteButton onClick={() => deleteMedRecord(r.id)} title="Delete record" />
                                </div>
                              )}
                            </div>
                            {r.comments && (
                              <div className="text-white text-sm mt-1 italic">{r.comments}</div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                }
                {medCursor && (
                  <button onClick={loadMoreMedRecords} disabled={medLoadingMore}
                    className="mt-2 w-full text-xs text-white hover:text-white border border-white/20 hover:border-white/40 rounded px-3 py-1.5 transition-colors disabled:opacity-50">
                    {medLoadingMore ? "Loading…" : "Load more"}
                  </button>
                )}
                {!medCursor && medRecords.length > 0 && (
                  <p className="mt-2 text-center text-xs text-white">end of range</p>
                )}
              </>
            )}
          </>
        )}

        {/* ── OBSERVATIONS TAB ── */}

        {tab === "observations" && !selectedObs && (
          <>
            {obsSummaryLoading && <div className="text-white text-center py-8">Loading…</div>}
            {!obsSummaryLoading && obsSummaries.length === 0 && (
              <p className="text-white text-center py-8">No observations recorded yet.</p>
            )}
            {!obsSummaryLoading && obsSummaries.length > 0 && (
              <ul className="flex flex-col gap-2">
                {obsSummaries.map(o => {
                  const cfg = obsConfigByLower.get(o.observation_type.trim().toLowerCase())
                  const thresh = cfg?.stale_after_hours ?? null
                  const stale = isStaleReading(o.last_recorded, thresh)
                  return (
                  <li key={o.observation_type}>
                    <button onClick={() => selectObs(o)}
                      type="button"
                      className={
                        "w-full rounded-xl px-4 py-3 text-left flex justify-between items-center gap-2 transition-colors " +
                        (stale
                          ? "ring-2 ring-amber-400/70 bg-amber-500/15 hover:bg-amber-500/22 active:bg-amber-500/28"
                          : "bg-white/10 hover:bg-white/20 active:bg-white/30")
                      }>
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-bold text-base">{o.observation_type}</div>
                        <div className="text-white text-2xl font-bold mt-0.5">
                          {o.observation_type === "Blood Pressure"
                            ? o.latest_value
                            : o.observation_type === "Hydration"
                              ? hydrationTodayMl === null
                                ? "…"
                                : hydrationTodayMl === "error"
                                  ? <>{o.latest_value} {o.latest_unit}</>
                                  : `${formatHydration(hydrationTodayMl)} today`
                              : (() => {
                                  const n = typeof o.latest_value === "number"
                                    ? o.latest_value
                                    : parseFloat(String(o.latest_value))
                                  if (!Number.isFinite(n)) return <>{o.latest_value} {o.latest_unit}</>
                                  const shown = displayObsValue(n, o.latest_unit, o.observation_type, measurementSystem)
                                  return <>{shown.value} {shown.unit}</>
                                })()}
                        </div>
                        <div className="text-white text-sm mt-0.5">
                          🕐 Last recorded: {fmtObsAU(o.last_recorded)}
                        </div>
                        {stale && thresh != null && (
                          <div className="text-amber-100 text-xs font-semibold mt-1 leading-snug">
                            Stale — older than suggested {formatStaleThresholdHours(thresh)} between readings.
                          </div>
                        )}
                        <div className="text-white text-sm">
                          {o.total_count} observation{o.total_count === 1 ? "" : "s"} recorded
                        </div>
                      </div>
                      <span className="text-white text-2xl leading-none shrink-0">›</span>
                    </button>
                  </li>
                  )
                })}
              </ul>
            )}
          </>
        )}

        {tab === "observations" && selectedObs && (() => {
          const hasObsChart = observationHasChart(selectedObs.observation_type)

          const periodControls = (
            <>
              <div className="flex gap-2">
                {[7, 30, 90].map(days => (
                  <button key={days} type="button" onClick={() => applyObsPreset(days)}
                    className="flex-1 text-xs text-white border border-white/30 hover:bg-white/10 rounded px-2 py-1 font-semibold transition-colors">
                    {days}d
                  </button>
                ))}
              </div>
              <div className="flex gap-2 items-center">
                <input type="date" value={obsFrom} onChange={e => setObsFrom(e.target.value)}
                  className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1 text-gray-800" />
                <span className="text-white text-xs">→</span>
                <input type="date" value={obsTo} onChange={e => setObsTo(e.target.value)}
                  className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1 text-gray-800" />
                <button onClick={() => { loadObsRecords(); loadObsChartData() }}
                  className="bg-fc-blue-dark text-white text-xs px-3 py-1 rounded font-bold">Go</button>
              </div>
            </>
          )

          const navHeader = (
            <>
              <button type="button" onClick={() => selectObs(null)}
                className="flex items-center gap-1 text-white hover:text-white font-semibold transition-colors">
                <span className="text-xl leading-none">‹</span>
                <span>{selectedObs.observation_type}</span>
              </button>

              {(() => {
                const selCfg = obsConfigByLower.get(selectedObs.observation_type.trim().toLowerCase())
                const h = selCfg?.stale_after_hours ?? null
                if (h == null || h <= 0 || !isStaleReading(selectedObs.last_recorded, h)) return null
                return (
                  <div className="rounded-lg border border-amber-400/65 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 leading-snug">
                    <span className="font-bold">🕐 Stale reading</span>
                    {" "}
                    — latest value is older than this type&apos;s suggested refresh window ({formatStaleThresholdHours(h)}).
                    {" "}
                    <span className="text-white">Recorded {fmtObsAU(selectedObs.last_recorded)}.</span>
                  </div>
                )
              })()}
            </>
          )

          return (
          <div className="flex flex-col flex-1 min-h-0 gap-3">
            {!hasObsChart && (
              <div className="shrink-0 flex flex-col gap-3">
                {navHeader}
                {periodControls}
              </div>
            )}

            {obsRecordsLoading && <div className="shrink-0 text-white text-center py-8">Loading…</div>}

            {selectedObs.observation_type === "Hydration" && (
              <div className="flex flex-col gap-4 lg:grid lg:grid-cols-5 lg:grid-rows-[minmax(0,1fr)] lg:gap-4 lg:flex-1 lg:min-h-0">
                <div className="flex flex-col gap-2 lg:col-span-3 min-w-0 min-h-0 shrink-0 lg:min-h-0
                                 sticky top-0 z-10 bg-fc-blue pb-2 lg:static lg:bg-transparent lg:pb-0">
                  {navHeader}
                  {periodControls}
                  {obsChartLoading
                    ? (
                      <div className="bg-white/10 rounded-xl p-3">
                        <div className="aspect-[20/7] flex items-center justify-center text-white text-sm">
                          Loading…
                        </div>
                      </div>
                    )
                    : (
                      <>
                        <div className="bg-white/10 rounded-xl p-3">
                          <HydrationBarChart
                            data={obsChartData.map(r => ({ date: r.recorded_at, value: r.value, unit: r.unit }))}
                            goalMl={obsGoal?.goal_type === "daily_min" ? obsGoal.target_value : undefined}
                            describedById={obsRecords.length > 0 ? "hydration-chart-data-table" : undefined}
                          />
                        </div>
                        <p className="text-white text-xs">
                          {obsChartData.length} record{obsChartData.length === 1 ? "" : "s"} in selected period
                        </p>
                      </>
                    )
                  }
                </div>
                {!obsRecordsLoading && obsRecords.length > 0 && (
                  <div className="lg:col-span-2 min-h-0 min-w-0 overflow-x-auto fc-scroll lg:overflow-y-auto">
                    <table id="hydration-chart-data-table" className="w-full text-sm">
                      <caption className="sr-only">Hydration records for the chart</caption>
                      <thead>
                        <tr className="text-white text-xs border-b border-white/10">
                          <th className="text-left pb-1 pr-2 font-normal">Date/Time</th>
                          <th className="text-left pb-1 pr-2 font-normal">Value</th>
                          <th className="text-left pb-1 font-normal">Comments</th>
                          {canDelete && <th className="pb-1 min-w-[9rem]"></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {obsRecords.map(r => {
                          if (editingObsId === r.id && obsDraft) return (
                            <tr key={r.id} className="border-t border-white/10">
                              <td colSpan={99} className="py-2">
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex gap-2">
                                    <input type="date" value={obsDraft.date} onChange={e => setObsDraft(d => ({ ...d!, date: e.target.value }))}
                                      className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                    <input type="time" value={obsDraft.time} onChange={e => setObsDraft(d => ({ ...d!, time: e.target.value }))}
                                      className="w-24 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                  </div>
                                  <div className="flex gap-2">
                                    <input type="number" value={obsDraft.value} step="any" placeholder="Value"
                                      onChange={e => setObsDraft(d => ({ ...d!, value: e.target.value }))}
                                      className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                    <input type="text" value={obsDraft.unit} onChange={e => setObsDraft(d => ({ ...d!, unit: e.target.value }))}
                                      className="w-20 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                  </div>
                                  <input type="text" value={obsDraft.comments} placeholder="Comments"
                                    onChange={e => setObsDraft(d => ({ ...d!, comments: e.target.value }))}
                                    className="text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                  <div className="flex gap-2 justify-end">
                                    <button onClick={() => { setEditingObsId(null); setObsDraft(null) }}
                                      className="text-white text-xs px-3 py-1.5 rounded border border-white/20 hover:bg-white/10">Cancel</button>
                                    <button onClick={saveObsRecord}
                                      className="bg-fc-blue-dark text-white text-xs px-4 py-1.5 rounded font-bold hover:bg-fc-blue-mid">Save</button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )
                          return (
                            <tr key={r.id} className="border-t border-white/10">
                              <td className="py-2 pr-2 text-white text-xs whitespace-nowrap">{fmtObsAU(r.recorded_at)}</td>
                              <td className="py-2 pr-2 text-white whitespace-nowrap">{r.value} {r.unit}</td>
                              <td className="py-2 text-white italic text-sm">{r.comments ?? ""}</td>
                              {canDelete && (
                                <td className="py-2 text-center">
                                  <div className="flex gap-2 justify-center">
                                    <EntityRowEditButton onClick={() => startEditObs(r)} title="Edit" />
                                    <EntityRowDeleteButton onClick={() => deleteObsRecord(r.id)} title="Delete" />
                                  </div>
                                </td>
                              )}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    {isPaginatedObsType(selectedObs.observation_type) && obsCursor && (
                      <button onClick={loadMoreObsRecords} disabled={obsLoadingMore}
                        className="mt-2 w-full text-xs text-white hover:text-white border border-white/20 hover:border-white/40 rounded px-3 py-1.5 transition-colors disabled:opacity-50">
                        {obsLoadingMore ? "Loading…" : "Load more"}
                      </button>
                    )}
                    {isPaginatedObsType(selectedObs.observation_type) && !obsCursor && obsRecords.length > 0 && (
                      <p className="mt-2 text-center text-xs text-white">end of range</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {OBS_HISTORY_CHART_TYPES.has(selectedObs.observation_type) && (
              <div className="flex flex-col gap-4 lg:grid lg:grid-cols-5 lg:grid-rows-[minmax(0,1fr)] lg:gap-4 lg:flex-1 lg:min-h-0">
                <div className="flex flex-col gap-2 lg:col-span-3 min-w-0 min-h-0 shrink-0 lg:min-h-0
                                 sticky top-0 z-10 bg-fc-blue pb-2 lg:static lg:bg-transparent lg:pb-0">
                  {navHeader}
                  {periodControls}
                  {obsChartLoading
                    ? (
                      <div className="bg-white/10 rounded-xl p-3">
                        <div className="aspect-[8/3] flex items-center justify-center text-white text-sm">
                          Loading…
                        </div>
                      </div>
                    )
                    : (
                      <>
                        {obsChartData.length < 2
                          ? <p className="text-white text-center py-4 text-sm lg:text-left">
                              Not enough data to display a chart — need at least 2 observations.
                            </p>
                          : <div className="bg-white/10 rounded-xl p-3">
                              {(() => {
                                const series = chartSeriesForObs(obsChartData, selectedObs.observation_type, measurementSystem)
                                return (
                              <LineChart
                                data={series.data}
                                unit={series.unit}
                                label={selectedObs.observation_type}
                                goalMin={obsGoal?.goal_type === "range" ? convertGoalValue(obsGoal.target_value, obsGoal.unit, selectedObs.observation_type, series.unit) : undefined}
                                goalMax={obsGoal?.goal_type === "range" ? convertGoalValue(obsGoal.target_max ?? undefined, obsGoal.unit, selectedObs.observation_type, series.unit) : undefined}
                                goalTarget={obsGoal?.goal_type === "trend" ? convertGoalValue(obsGoal.target_value, obsGoal.unit, selectedObs.observation_type, series.unit) : undefined}
                                goalDate={obsGoal?.target_date ?? undefined}
                                describedById={obsRecords.length > 0 ? "obs-line-chart-data-table" : undefined}
                              />
                                )
                              })()}
                            </div>
                        }
                        <p className="text-white text-xs">
                          {obsChartData.length} observation{obsChartData.length === 1 ? "" : "s"} in selected period
                        </p>
                      </>
                    )
                  }
                </div>
                {!obsRecordsLoading && obsRecords.length > 0 && (
                  <div className="lg:col-span-2 min-h-0 min-w-0 overflow-x-auto fc-scroll lg:overflow-y-auto">
                    <table id="obs-line-chart-data-table" className="w-full text-sm">
                      <caption className="sr-only">{selectedObs.observation_type} records for the chart</caption>
                      <thead>
                        <tr className="text-white text-xs border-b border-white/10">
                          <th className="text-left pb-1 pr-2 font-normal">Date/Time</th>
                          <th className="text-left pb-1 pr-2 font-normal">Value</th>
                          <th className="text-left pb-1 font-normal">Comments</th>
                          {canDelete && <th className="pb-1 min-w-[9rem]"></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {obsRecords.map(r => {
                          if (editingObsId === r.id && obsDraft) return (
                            <tr key={r.id} className="border-t border-white/10">
                              <td colSpan={99} className="py-2">
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex gap-2">
                                    <input type="date" value={obsDraft.date} onChange={e => setObsDraft(d => ({ ...d!, date: e.target.value }))}
                                      className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                    <input type="time" value={obsDraft.time} onChange={e => setObsDraft(d => ({ ...d!, time: e.target.value }))}
                                      className="w-24 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                  </div>
                                  <div className="flex gap-2">
                                    <input type="number" value={obsDraft.value} step="any" placeholder="Value"
                                      onChange={e => setObsDraft(d => ({ ...d!, value: e.target.value }))}
                                      className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                    {OBS_UNITS[obsDraft.observation_type] ? (
                                      <select value={obsDraft.unit} onChange={e => setObsDraft(d => ({ ...d!, unit: e.target.value }))}
                                        className="text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800">
                                        {OBS_UNITS[obsDraft.observation_type].map(u => <option key={u} value={u}>{u}</option>)}
                                      </select>
                                    ) : (
                                      <input type="text" value={obsDraft.unit} onChange={e => setObsDraft(d => ({ ...d!, unit: e.target.value }))}
                                        className="w-20 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                    )}
                                  </div>
                                  <input type="text" value={obsDraft.comments} placeholder="Comments"
                                    onChange={e => setObsDraft(d => ({ ...d!, comments: e.target.value }))}
                                    className="text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                  <div className="flex gap-2 justify-end">
                                    <button onClick={() => { setEditingObsId(null); setObsDraft(null) }}
                                      className="text-white text-xs px-3 py-1.5 rounded border border-white/20 hover:bg-white/10">Cancel</button>
                                    <button onClick={saveObsRecord}
                                      className="bg-fc-blue-dark text-white text-xs px-4 py-1.5 rounded font-bold hover:bg-fc-blue-mid">Save</button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )
                          return (
                            <tr key={r.id} className="border-t border-white/10">
                              <td className="py-2 pr-2 text-white text-xs whitespace-nowrap">{fmtObsAU(r.recorded_at)}</td>
                              <td className="py-2 pr-2 text-white whitespace-nowrap">{r.value} {r.unit}</td>
                              <td className="py-2 text-white italic text-sm">{r.comments ?? ""}</td>
                              {canDelete && (
                                <td className="py-2 text-center">
                                  <div className="flex gap-2 justify-center">
                                    <EntityRowEditButton onClick={() => startEditObs(r)} title="Edit" />
                                    <EntityRowDeleteButton onClick={() => deleteObsRecord(r.id)} title="Delete" />
                                  </div>
                                </td>
                              )}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    {isPaginatedObsType(selectedObs.observation_type) && obsCursor && (
                      <button onClick={loadMoreObsRecords} disabled={obsLoadingMore}
                        className="mt-2 w-full text-xs text-white hover:text-white border border-white/20 hover:border-white/40 rounded px-3 py-1.5 transition-colors disabled:opacity-50">
                        {obsLoadingMore ? "Loading…" : "Load more"}
                      </button>
                    )}
                    {isPaginatedObsType(selectedObs.observation_type) && !obsCursor && obsRecords.length > 0 && (
                      <p className="mt-2 text-center text-xs text-white">end of range</p>
                    )}
                  </div>
                )}
              </div>

            )}

            {/* ── Blood Pressure: dual-line chart + grouped table ── */}
            {!obsRecordsLoading && selectedObs.observation_type === "Blood Pressure" && (() => {
              const bpRows = buildBpTableRows(obsRecords)
              const pairedAsc = bpRows
                .filter((r): r is Extract<BpDetailRow, { kind: "pair" }> => r.kind === "pair")
                .reverse()
              const sysSeries = pairedAsc.map(p => ({ date: p.recorded_at, value: p.sys.value }))
              const diaSeries = pairedAsc.map(p => ({ date: p.recorded_at, value: p.dia.value }))
              return (
                <div className="flex flex-col gap-4 lg:grid lg:grid-cols-5 lg:grid-rows-[minmax(0,1fr)] lg:gap-4 lg:flex-1 lg:min-h-0">
                  <div className="flex flex-col gap-2 lg:col-span-3 min-w-0 min-h-0 shrink-0 lg:min-h-0
                                   sticky top-0 z-10 bg-fc-blue pb-2 lg:static lg:bg-transparent lg:pb-0">
                    {navHeader}
                    {periodControls}
                    {pairedAsc.length >= 2 ? (
                      <div className="bg-white/10 rounded-xl p-3">
                        <LineChart
                          data={sysSeries}
                          secondaryData={diaSeries}
                          unit="mmHg"
                          label="Blood Pressure"
                          primaryColor="#FFFFFF"
                          secondaryColor="#FFD700"
                          primaryLabel="Systolic"
                          secondaryLabel="Diastolic"
                          describedById={bpRows.length > 0 ? "bp-chart-data-table" : undefined}
                        />
                      </div>
                    ) : (
                      <p className="text-white text-center py-4 text-sm lg:text-left">
                        Not enough paired readings for a chart — need at least two complete systolic/diastolic pairs.
                      </p>
                    )}
                    <p className="text-white text-xs">
                      {bpRows.length} reading{bpRows.length === 1 ? "" : "s"} in selected period
                    </p>
                  </div>
                  {bpRows.length === 0 ? (
                    <div className="lg:col-span-2 min-h-0 min-w-0">
                      <p className="text-white text-center py-8 lg:py-4 lg:text-left">No readings in this period.</p>
                    </div>
                  ) : (
                    <div className="lg:col-span-2 min-h-0 min-w-0 overflow-x-auto fc-scroll lg:overflow-y-auto">
                      <table id="bp-chart-data-table" className="w-full text-sm">
                        <caption className="sr-only">Blood pressure records for the chart</caption>
                        <thead>
                          <tr className="text-white text-xs border-b border-white/10">
                            <th className="text-left pb-1 pr-2 font-normal">Date/Time</th>
                            <th className="text-left pb-1 pr-2 font-normal">Value</th>
                            <th className="text-left pb-1 font-normal">Comments</th>
                            {canDelete && <th className="pb-1 min-w-[9rem]"></th>}
                          </tr>
                        </thead>
                        <tbody>
                          {bpRows.map(row => {
                            if (row.kind === "pair") {
                              if (editingBpSession === row.session_id && bpDraft) {
                                return (
                                  <tr key={`bp-pair-${row.session_id}`} className="border-t border-white/10">
                                    <td colSpan={99} className="py-2">
                                      <div className="flex flex-col gap-1.5 py-1">
                                        <div className="flex gap-2">
                                          <input type="date" value={bpDraft.date} onChange={e => setBpDraft(d => ({ ...d!, date: e.target.value }))}
                                            className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                          <input type="time" value={bpDraft.time} onChange={e => setBpDraft(d => ({ ...d!, time: e.target.value }))}
                                            className="w-24 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                        </div>
                                        <div className="flex gap-2 items-center">
                                          <div className="flex flex-col gap-0.5 flex-1">
                                            <span className="text-white text-sm">Systolic</span>
                                            <input type="number" value={bpDraft.systolic} step="1" min="0"
                                              onChange={e => setBpDraft(d => ({ ...d!, systolic: e.target.value }))}
                                              className="text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                          </div>
                                          <span className="text-white font-bold self-end mb-2">/</span>
                                          <div className="flex flex-col gap-0.5 flex-1">
                                            <span className="text-white text-sm">Diastolic</span>
                                            <input type="number" value={bpDraft.diastolic} step="1" min="0"
                                              onChange={e => setBpDraft(d => ({ ...d!, diastolic: e.target.value }))}
                                              className="text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                          </div>
                                          <span className="text-white text-xs self-end mb-2">mmHg</span>
                                        </div>
                                        <input type="text" value={bpDraft.comments} placeholder="Comments"
                                          onChange={e => setBpDraft(d => ({ ...d!, comments: e.target.value }))}
                                          className="text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                        <div className="flex gap-2 justify-end">
                                          <button type="button" onClick={() => { setEditingBpSession(null); setBpDraft(null) }}
                                            className="text-white text-xs px-3 py-1.5 rounded border border-white/20 hover:bg-white/10">Cancel</button>
                                          <button type="button" onClick={saveBpPair}
                                            className="bg-fc-blue-dark text-white text-xs px-4 py-1.5 rounded font-bold hover:bg-fc-blue-mid">Save</button>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )
                              }
                              return (
                                <tr key={`bp-pair-${row.session_id}`} className="border-t border-white/10">
                                  <td className="py-2 pr-2 text-white text-xs whitespace-nowrap">{fmtObsAU(row.recorded_at)}</td>
                                  <td className="py-2 pr-2 text-white whitespace-nowrap font-semibold">
                                    {row.sys.value}/{row.dia.value} mmHg
                                  </td>
                                  <td className="py-2 text-white italic text-sm">{row.comments ?? ""}</td>
                                  {canDelete && (
                                    <td className="py-2 text-center">
                                      <div className="flex gap-2 justify-center">
                                        <EntityRowEditButton onClick={() => startEditBp(row)} title="Edit" />
                                        <EntityRowDeleteButton
                                          onClick={() => deleteBpPair(row.sys.id, row.dia.id)}
                                          title="Delete"
                                        />
                                      </div>
                                    </td>
                                  )}
                                </tr>
                              )
                            }
                            const r = row.record
                            if (editingObsId === r.id && obsDraft) return (
                              <tr key={`bp-single-${r.id}`} className="border-t border-white/10">
                                <td colSpan={99} className="py-2">
                                  <div className="flex flex-col gap-1.5">
                                    <div className="flex gap-2">
                                      <input type="date" value={obsDraft.date} onChange={e => setObsDraft(d => ({ ...d!, date: e.target.value }))}
                                        className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                      <input type="time" value={obsDraft.time} onChange={e => setObsDraft(d => ({ ...d!, time: e.target.value }))}
                                        className="w-24 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                    </div>
                                    <div className="flex gap-2">
                                      <input type="number" value={obsDraft.value} step="any" placeholder="Value"
                                        onChange={e => setObsDraft(d => ({ ...d!, value: e.target.value }))}
                                        className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                      <select value={obsDraft.unit} onChange={e => setObsDraft(d => ({ ...d!, unit: e.target.value }))}
                                        className="text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800">
                                        {(OBS_UNITS["Blood Pressure"] ?? ["mmHg"]).map(u => (
                                          <option key={u} value={u}>{u}</option>
                                        ))}
                                      </select>
                                    </div>
                                    <input type="text" value={obsDraft.comments} placeholder="Comments"
                                      onChange={e => setObsDraft(d => ({ ...d!, comments: e.target.value }))}
                                      className="text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                    <div className="flex gap-2 justify-end">
                                      <button type="button" onClick={() => { setEditingObsId(null); setObsDraft(null) }}
                                        className="text-white text-xs px-3 py-1.5 rounded border border-white/20 hover:bg-white/10">Cancel</button>
                                      <button type="button" onClick={saveObsRecord}
                                        className="bg-fc-blue-dark text-white text-xs px-4 py-1.5 rounded font-bold hover:bg-fc-blue-mid">Save</button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )
                            return (
                              <tr key={`bp-single-${r.id}`} className="border-t border-white/10">
                                <td className="py-2 pr-2 text-white text-xs whitespace-nowrap">{fmtObsAU(r.recorded_at)}</td>
                                <td className="py-2 pr-2 text-white whitespace-nowrap">{formatBpSingle(r)}</td>
                                <td className="py-2 text-white italic text-sm">{r.comments ?? ""}</td>
                                {canDelete && (
                                  <td className="py-2 text-center">
                                    <div className="flex gap-2 justify-center">
                                      <EntityRowEditButton onClick={() => startEditObs(r)} title="Edit" />
                                      <EntityRowDeleteButton onClick={() => deleteObsRecord(r.id)} title="Delete" />
                                    </div>
                                  </td>
                                )}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })()}

            {!obsRecordsLoading && !OBS_HISTORY_CHART_TYPES.has(selectedObs.observation_type) && selectedObs.observation_type !== "Blood Pressure" && selectedObs.observation_type !== "Hydration" && (
              <div className="flex flex-col flex-1 min-h-0 gap-2">
                <p className="shrink-0 text-white text-xs mb-2">
                  {obsRecords.length} observation{obsRecords.length === 1 ? "" : "s"} loaded
                </p>
                {obsRecords.length === 0
                  ? <p className="text-white text-center py-8">No observations in this period.</p>
                  : <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto fc-scroll lg:overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-white text-xs border-b border-white/10">
                            <th className="text-left pb-1 pr-2 font-normal">Date/Time</th>
                            <th className="text-left pb-1 pr-2 font-normal">Value</th>
                            <th className="text-left pb-1 pr-2 font-normal">Unit</th>
                            <th className="text-left pb-1 font-normal">Comments</th>
                            {canDelete && <th className="pb-1 min-w-[9rem]"></th>}
                          </tr>
                        </thead>
                        <tbody>
                          {obsRecords.map(r => {
                            if (editingObsId === r.id && obsDraft) return (
                              <tr key={r.id} className="border-t border-white/10">
                                <td colSpan={99} className="py-2">
                                  <div className="flex flex-col gap-1.5">
                                    <div className="flex gap-2">
                                      <input type="date" value={obsDraft.date} onChange={e => setObsDraft(d => ({ ...d!, date: e.target.value }))}
                                        className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                      <input type="time" value={obsDraft.time} onChange={e => setObsDraft(d => ({ ...d!, time: e.target.value }))}
                                        className="w-24 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                    </div>
                                    <div className="flex gap-2">
                                      <input type="number" value={obsDraft.value} step="any" placeholder="Value"
                                        onChange={e => setObsDraft(d => ({ ...d!, value: e.target.value }))}
                                        className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                      {OBS_UNITS[obsDraft.observation_type] ? (
                                        <select value={obsDraft.unit} onChange={e => setObsDraft(d => ({ ...d!, unit: e.target.value }))}
                                          className="text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800">
                                          {OBS_UNITS[obsDraft.observation_type].map(u => <option key={u} value={u}>{u}</option>)}
                                        </select>
                                      ) : (
                                        <input type="text" value={obsDraft.unit} onChange={e => setObsDraft(d => ({ ...d!, unit: e.target.value }))}
                                          className="w-20 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                      )}
                                    </div>
                                    <input type="text" value={obsDraft.comments} placeholder="Comments"
                                      onChange={e => setObsDraft(d => ({ ...d!, comments: e.target.value }))}
                                      className="text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                    <div className="flex gap-2 justify-end">
                                      <button onClick={() => { setEditingObsId(null); setObsDraft(null) }}
                                        className="text-white text-xs px-3 py-1.5 rounded border border-white/20 hover:bg-white/10">Cancel</button>
                                      <button onClick={saveObsRecord}
                                        className="bg-fc-blue-dark text-white text-xs px-4 py-1.5 rounded font-bold hover:bg-fc-blue-mid">Save</button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )
                            return (
                              <tr key={r.id} className="border-t border-white/10">
                                <td className="py-2 pr-2 text-white text-xs whitespace-nowrap">{fmtObsAU(r.recorded_at)}</td>
                                <td className="py-2 pr-2 text-white">{r.value}</td>
                                <td className="py-2 pr-2 text-white">{r.unit}</td>
                                <td className="py-2 text-white italic text-sm">{r.comments ?? ""}</td>
                                {canDelete && (
                                  <td className="py-2 text-center">
                                    <div className="flex gap-2 justify-center">
                                      <EntityRowEditButton onClick={() => startEditObs(r)} title="Edit" />
                                      <EntityRowDeleteButton onClick={() => deleteObsRecord(r.id)} title="Delete" />
                                    </div>
                                  </td>
                                )}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      {isPaginatedObsType(selectedObs.observation_type) && obsCursor && (
                        <button onClick={loadMoreObsRecords} disabled={obsLoadingMore}
                          className="mt-2 w-full text-xs text-white hover:text-white border border-white/20 hover:border-white/40 rounded px-3 py-1.5 transition-colors disabled:opacity-50">
                          {obsLoadingMore ? "Loading…" : "Load more"}
                        </button>
                      )}
                      {isPaginatedObsType(selectedObs.observation_type) && !obsCursor && obsRecords.length > 0 && (
                        <p className="mt-2 text-center text-xs text-white">end of range</p>
                      )}
                    </div>
                }
              </div>
            )}
          </div>
          )
        })()}

        {/* ── DATE TAB ── */}

        {tab === "date" && (
          <>
            <div className="flex gap-2 items-center mb-3">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1 text-gray-800" />
              <span className="text-white text-xs">→</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1 text-gray-800" />
              <button onClick={loadDateEntries}
                className="bg-fc-blue-dark text-white text-xs px-3 py-1 rounded font-bold">Go</button>
            </div>

            {dateLoading && <div className="text-white text-center py-8">Loading…</div>}

            {!dateLoading && (
              <>
                <p className="text-white text-xs mb-2">
                  {mergedDateEntries.length} entr{mergedDateEntries.length === 1 ? "y" : "ies"} in selected period
                </p>
                {mergedDateEntries.length === 0
                  ? <p className="text-white text-center py-8">No records in this period.</p>
                  : <ul className="flex flex-col gap-1">
                      {visibleDateEntries.map((entry, i) => {
                        const prev = visibleDateEntries[i - 1]
                        const t = mergedItemTime(entry)
                        const prevT = prev ? mergedItemTime(prev) : t
                        const showSep = i === 0 || dateKey(t) !== dateKey(prevT)
                        const listKey =
                          entry.kind === "bp_pair" ? `bp-${entry.sys.id}-${entry.dia.id}`
                            : entry.kind === "med" ? `med-${entry.entry.id}`
                            : `obs-${entry.entry.id}`

                        const bpEditForm =
                          entry.kind === "bp_pair" &&
                          entry.sys.session_id &&
                          editingBpSession === entry.sys.session_id &&
                          bpDraft ? (
                          <div className="bg-white/10 rounded-xl px-3 py-3 flex flex-col gap-2">
                            <div className="flex gap-2">
                              <input type="date" value={bpDraft.date} onChange={e => setBpDraft(d => ({ ...d!, date: e.target.value }))}
                                className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                              <input type="time" value={bpDraft.time} onChange={e => setBpDraft(d => ({ ...d!, time: e.target.value }))}
                                className="w-24 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                            </div>
                            <div className="flex gap-2 items-center">
                              <div className="flex flex-col gap-0.5 flex-1">
                                <span className="text-white text-sm">Systolic</span>
                                <input type="number" value={bpDraft.systolic} step="1" min="0"
                                  onChange={e => setBpDraft(d => ({ ...d!, systolic: e.target.value }))}
                                  className="text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                              </div>
                              <span className="text-white font-bold mt-6">/</span>
                              <div className="flex flex-col gap-0.5 flex-1">
                                <span className="text-white text-sm">Diastolic</span>
                                <input type="number" value={bpDraft.diastolic} step="1" min="0"
                                  onChange={e => setBpDraft(d => ({ ...d!, diastolic: e.target.value }))}
                                  className="text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                              </div>
                              <span className="text-white text-xs mt-6 shrink-0">mmHg</span>
                            </div>
                            <input type="text" value={bpDraft.comments} placeholder="Comments"
                              onChange={e => setBpDraft(d => ({ ...d!, comments: e.target.value }))}
                              className="text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                            <div className="flex gap-2 justify-end">
                              <button type="button" onClick={() => { setEditingBpSession(null); setBpDraft(null) }}
                                className="text-white text-xs px-3 py-1.5 rounded border border-white/20 hover:bg-white/10">Cancel</button>
                              <button type="button" onClick={saveBpPair}
                                className="bg-fc-blue-dark text-white text-xs px-4 py-1.5 rounded font-bold hover:bg-fc-blue-mid">Save</button>
                            </div>
                          </div>
                        ) : null

                        return (
                          <li key={listKey}>
                            {showSep && (
                              <div className="flex items-center gap-2 my-2">
                                <div className="flex-1 h-px bg-white/20"></div>
                                <span className="text-white text-xs whitespace-nowrap">
                                  {fmtDateLabel(t)}
                                </span>
                                <div className="flex-1 h-px bg-white/20"></div>
                              </div>
                            )}
                            {entry.kind === "med" && editingMedId === entry.entry.id && medDraft ? (
                              <div className="bg-white/10 rounded-xl px-3 py-3 flex flex-col gap-2">
                                <div className="flex gap-2">
                                  <input type="date" value={medDraft.date} onChange={e => setMedDraft(d => ({ ...d!, date: e.target.value }))}
                                    className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                  <input type="time" value={medDraft.time} onChange={e => setMedDraft(d => ({ ...d!, time: e.target.value }))}
                                    className="w-24 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                </div>
                                <div className="flex gap-2">
                                  <input type="number" value={medDraft.dosage} min="0" step="0.1" placeholder="Dosage"
                                    onChange={e => setMedDraft(d => ({ ...d!, dosage: e.target.value }))}
                                    className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                  <select value={medDraft.dosage_unit} onChange={e => setMedDraft(d => ({ ...d!, dosage_unit: e.target.value }))}
                                    className="text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800">
                                    {DOSAGE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                                  </select>
                                </div>
                                <input type="text" value={medDraft.comments} placeholder="Comments"
                                  onChange={e => setMedDraft(d => ({ ...d!, comments: e.target.value }))}
                                  className="text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                <div className="flex gap-2 justify-end">
                                  <button type="button" onClick={() => { setEditingMedId(null); setMedDraft(null) }}
                                    className="text-white text-xs px-3 py-1.5 rounded border border-white/20 hover:bg-white/10">Cancel</button>
                                  <button type="button" onClick={saveMedRecord}
                                    className="bg-fc-blue-dark text-white text-xs px-4 py-1.5 rounded font-bold hover:bg-fc-blue-mid">Save</button>
                                </div>
                              </div>
                            ) : entry.kind === "obs" && editingObsId === entry.entry.id && obsDraft ? (
                              <div className="bg-white/10 rounded-xl px-3 py-3 flex flex-col gap-2">
                                <div className="flex gap-2">
                                  <input type="date" value={obsDraft.date} onChange={e => setObsDraft(d => ({ ...d!, date: e.target.value }))}
                                    className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                  <input type="time" value={obsDraft.time} onChange={e => setObsDraft(d => ({ ...d!, time: e.target.value }))}
                                    className="w-24 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                </div>
                                <div className="flex gap-2">
                                  <input type="number" value={obsDraft.value} step="any" placeholder="Value"
                                    onChange={e => setObsDraft(d => ({ ...d!, value: e.target.value }))}
                                    className="flex-1 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                  {OBS_UNITS[obsDraft.observation_type] ? (
                                    <select value={obsDraft.unit} onChange={e => setObsDraft(d => ({ ...d!, unit: e.target.value }))}
                                      className="text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800">
                                      {OBS_UNITS[obsDraft.observation_type].map(u => <option key={u} value={u}>{u}</option>)}
                                    </select>
                                  ) : (
                                    <input type="text" value={obsDraft.unit} onChange={e => setObsDraft(d => ({ ...d!, unit: e.target.value }))}
                                      className="w-20 text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                  )}
                                </div>
                                <input type="text" value={obsDraft.comments} placeholder="Comments"
                                  onChange={e => setObsDraft(d => ({ ...d!, comments: e.target.value }))}
                                  className="text-xs bg-white border border-gray-300 rounded px-2 py-1.5 text-gray-800" />
                                <div className="flex gap-2 justify-end">
                                  <button type="button" onClick={() => { setEditingObsId(null); setObsDraft(null) }}
                                    className="text-white text-xs px-3 py-1.5 rounded border border-white/20 hover:bg-white/10">Cancel</button>
                                  <button type="button" onClick={saveObsRecord}
                                    className="bg-fc-blue-dark text-white text-xs px-4 py-1.5 rounded font-bold hover:bg-fc-blue-mid">Save</button>
                                </div>
                              </div>
                            ) : bpEditForm ? (
                              bpEditForm
                            ) : (
                              <div className="bg-white/10 rounded-xl px-3 py-3 flex gap-3 items-start">
                                <span className="text-xl shrink-0 mt-0.5">
                                  {entry.kind === "med" ? "💊" : "📏"}
                                </span>
                                <div className="flex-1 min-w-0">
                                  {entry.kind === "med" ? (
                                    <>
                                      <div className="flex justify-between items-start gap-2">
                                        <span className="text-white font-bold text-base">{entry.entry.medication_name}</span>
                                        <span className="text-white text-xs whitespace-nowrap shrink-0">{fmtTimeAU(entry.entry.recorded_at)}</span>
                                      </div>
                                      {entry.entry.dosage != null && (
                                        <div className="text-white text-sm mt-0.5">{entry.entry.dosage} {entry.entry.dosage_unit}</div>
                                      )}
                                      {entry.entry.comments && (
                                        <div className="text-white text-sm mt-1 italic">{entry.entry.comments}</div>
                                      )}
                                    </>
                                  ) : entry.kind === "bp_pair" ? (
                                    <>
                                      <div className="flex justify-between items-start gap-2">
                                        <span className="text-white font-bold text-base">Blood Pressure</span>
                                        <span className="text-white text-xs whitespace-nowrap shrink-0">{fmtTimeAU(entry.recorded_at)}</span>
                                      </div>
                                      <div className="text-white text-sm mt-0.5 font-semibold">
                                        {entry.sys.value}/{entry.dia.value} mmHg
                                      </div>
                                      {entry.comments && (
                                        <div className="text-white text-sm mt-1 italic">{entry.comments}</div>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      <div className="flex justify-between items-start gap-2">
                                        <span className="text-white font-bold text-base">{entry.entry.observation_type}</span>
                                        <span className="text-white text-xs whitespace-nowrap shrink-0">{fmtTimeAU(entry.entry.recorded_at)}</span>
                                      </div>
                                      <div className="text-white text-sm mt-0.5 font-semibold">
                                        {(entry.entry as ObsRecord).value_label
                                          ? `${(entry.entry as ObsRecord).value_label}: `
                                          : ""}
                                        {entry.entry.value} {entry.entry.unit}
                                      </div>
                                      {entry.entry.comments && (
                                        <div className="text-white text-sm mt-1 italic">{entry.entry.comments}</div>
                                      )}
                                    </>
                                  )}
                                </div>
                                {canDelete && (
                                  <div className="flex gap-2 items-center shrink-0">
                                    {entry.kind === "bp_pair" ? (
                                      <>
                                        <EntityRowEditButton
                                          onClick={() =>
                                            startEditBp({
                                              kind: "pair",
                                              session_id: entry.sys.session_id!,
                                              sys: entry.sys,
                                              dia: entry.dia,
                                              recorded_at: entry.recorded_at,
                                              comments: entry.comments,
                                            })
                                          }
                                          title="Edit"
                                        />
                                        <EntityRowDeleteButton
                                          onClick={() => deleteBpPair(entry.sys.id, entry.dia.id)}
                                          title="Delete"
                                        />
                                      </>
                                    ) : (
                                      <>
                                        <EntityRowEditButton
                                          onClick={() =>
                                            entry.kind === "med"
                                              ? startEditMed(entry.entry as MedRecord)
                                              : startEditObs(entry.entry as ObsRecord)
                                          }
                                          title="Edit"
                                        />
                                        <EntityRowDeleteButton
                                          onClick={() => deleteDateEntry(entry.kind, entry.entry.id)}
                                          title="Delete"
                                        />
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                }
                {mergedDateEntries.length > dateVisibleCount && (
                  <button
                    onClick={() => setDateVisibleCount(c => c + DATE_PAGE_SIZE)}
                    className="mt-2 w-full text-xs text-white hover:text-white border border-white/20 hover:border-white/40 rounded px-3 py-1.5 transition-colors"
                  >
                    Load more ({mergedDateEntries.length - dateVisibleCount} older)
                  </button>
                )}
                {mergedDateEntries.length > 0 && mergedDateEntries.length <= dateVisibleCount && (
                  <p className="mt-2 text-center text-xs text-white">end of range</p>
                )}
              </>
            )}
          </>
        )}

      </main>
      {confirmDlg && (
        <ConfirmModal
          open
          title={confirmDlg.title}
          message={confirmDlg.message}
          detail={confirmDlg.detail}
          variant={confirmDlg.variant}
          confirmLabel={confirmDlg.confirmLabel}
          cancelLabel={confirmDlg.cancelLabel}
          onCancel={() => setConfirmDlg(null)}
          onConfirm={confirmDlg.onConfirm}
        />
      )}
      <ConfirmModal
        open={prnClearedNoticeOpen}
        {...confirmCopy.prnPushRequestCleared}
        showCancel={false}
        onConfirm={() => setPrnClearedNoticeOpen(false)}
        onCancel={() => setPrnClearedNoticeOpen(false)}
      />
      <AppFooter />
    </div>
  )
}
