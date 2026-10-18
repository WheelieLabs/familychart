// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import AttachmentLink from "@/components/AttachmentViewer"
import { Suspense, useState, useEffect, useMemo, useRef } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import AppHeader, { PersonHeader } from "@/components/AppHeader"
import type { Crumb } from "@/lib/ui/breadcrumbs"
import AppFooter from "@/components/AppFooter"
import { FcTabBar, type FcTabItem } from "@/components/ui/FcTabBar"
import LineChart from "@/components/LineChart"
import HydrationBarChart from "@/components/HydrationBarChart"
import ConfirmModal, { confirmCopy, type ConfirmVariant } from "@/components/ConfirmModal"
import HistoryCalendar from "@/components/history/HistoryCalendar"
import {
  AdministeredByBadge,
  BpEditForm,
  FeedKindChips,
  FlagBadge,
  MedEditForm,
  MissedDoseCard,
  ObsEditForm,
  RangeFields,
  RecordTable,
  type BpDraft,
  type MedDraft,
  type ObsDraft,
} from "@/components/history/history-parts"
import Badge from "@/components/ui/Badge"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import { ChipGroup } from "@/components/ui/Chip"
import EmptyState, { EMPTY_STATE_ICONS } from "@/components/ui/EmptyState"
import EntityRowActions from "@/components/ui/EntityRowActions"
import ListCard, { CardList } from "@/components/ui/ListCard"
import PageContainer from "@/components/ui/PageContainer"
import type { ObservationGoal, ObservationTypeConfig, Person } from "@/lib/domain-types"
import { addCalendarDaysToIsoYmd, instantToZonedYmdHm, localDateAndTimeToUtcIso, zonedTodayYmd } from "@/lib/datetime"
import { formatDate, formatDateTime, formatRange, formatTime } from "@/lib/date-format"
import { formatStaleThresholdHours, isStaleReading } from "@/lib/observation/observation-staleness"
import { formatHydration } from "@/lib/format"
import { dashboardScheduleHeaders } from "@/lib/dashboard/dashboard-client-context"
import type { MeasurementSystem } from "@/lib/settings/registry"
import type { MedicationAdministeredBy } from "@/lib/medication/medication-administered-by"
import { OBSERVATION_UI_TYPES } from "@/lib/observation/observation-types"
import {
  mergeMissedIntoRecords,
  useMedicationHistory,
  type MedRecord,
} from "@/lib/medication/medication-history"
import {
  buildBpTableRows,
  chartSeriesForObs,
  convertGoalValue,
  displayObsValue,
  formatBpSingle,
  isPaginatedObsType,
  OBS_HISTORY_CHART_TYPES,
  useObservationHistory,
  type BpDetailRow,
  type ObsRecord,
  type ObsSummary,
} from "@/lib/observation/observation-history"
import { useHistoryFeed } from "@/lib/history/use-history-feed"
import { saveLinkDelta } from "@/components/LinkedItemsEditor"
import { DoseSymptomChip, SymptomDoseChip } from "@/components/LinkChips"
import { EMPTY_LINK_DELTA, groupLinksBy, type LinkDelta } from "@/lib/symptoms/link-editing"
import type { PersonLink } from "@/lib/symptoms/symptom-dose-link-types"
import { useRecordSummaries } from "@/lib/history/use-record-summaries"
import { parseSummaryRecord, summaryListUrl, summaryRecordUrl, type SummaryKind } from "@/lib/history/summary-selection"
import type { SymptomEventSummary } from "@/lib/symptoms/symptom-history"
import type { TestResultSummary } from "@/lib/test-results/test-result-history"
import {
  summariseSymptoms,
  summariseTestResults,
  symptomsForKey,
  testResultsForKey,
} from "@/lib/history/record-summaries"
import { isWithinTimelineWindow } from "@/lib/medication/medication-timeline"
import { feedChipKind, feedRowTimeText, medicationFlag, orderDayPanelRows, toFeedRows, type FeedRow, type FeedChipKind } from "@/lib/history/feed"
import { formatSlotHhmm } from "@/lib/medication/dose-timing-display"
import { monthBounds, shiftMonth, buildCalendarGrid, feedRowLocalYmd, symptomSpan } from "@/lib/history/calendar-grid"

function daysAgo(n: number, fromYmd: string): string {
  return addCalendarDaysToIsoYmd(fromYmd, -n)
}

/** Refreshes on tab focus/visibility so end-date defaults stay current across midnight. */
function useRefreshingLocalToday(): string {
  const [today, setToday] = useState(() => zonedTodayYmd())
  useEffect(() => {
    const bump = () => {
      const next = zonedTodayYmd()
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

const OBS_UNITS: Record<string, string[]> = {
  ...Object.fromEntries(OBSERVATION_UI_TYPES.map(t => [t.label, [...t.units]])),
  "Blood Pressure Systolic": ["mmHg"],
  "Blood Pressure Diastolic": ["mmHg"],
}

function splitDateTime(iso: string): { date: string; time: string } {
  return instantToZonedYmdHm(iso)
}

type HistoryTab = "activity" | "calendar" | "summaries"

const HISTORY_TABS: FcTabItem<HistoryTab>[] = [
  { value: "activity", label: "Activity" },
  { value: "calendar", label: "Calendar" },
  { value: "summaries", label: "Summaries" },
]

const SUMMARY_KIND_OPTIONS: { value: SummaryKind; label: string }[] = [
  { value: "medication", label: "Medication" },
  { value: "observation", label: "Observation" },
  { value: "symptom", label: "Symptom" },
  { value: "test_result", label: "Test Result" },
]

/** The plural a back link names: "‹ Medications". */
const SUMMARY_KIND_PLURAL: Record<SummaryKind, string> = {
  medication: "Medications",
  observation: "Observations",
  symptom: "Symptoms",
  test_result: "Test results",
}

function summariseKeys(kind: SummaryKind, r: { symptoms: SymptomEventSummary[]; testResults: TestResultSummary[] }): string[] {
  return (kind === "symptom" ? summariseSymptoms(r.symptoms) : summariseTestResults(r.testResults)).map(x => x.key)
}

/** The latest value shown on an observation summary card. */
function latestValueText(
  o: ObsSummary,
  hydrationTodayMl: number | "error" | null,
  measurementSystem: MeasurementSystem,
): string {
  if (o.observation_type === "Blood Pressure") return String(o.latest_value)
  if (o.observation_type === "Hydration") {
    if (hydrationTodayMl === null) return "…"
    if (hydrationTodayMl === "error") return `${o.latest_value} ${o.latest_unit}`
    return `${formatHydration(hydrationTodayMl)} today`
  }
  const n = typeof o.latest_value === "number" ? o.latest_value : parseFloat(String(o.latest_value))
  if (!Number.isFinite(n)) return `${o.latest_value} ${o.latest_unit}`
  const shown = displayObsValue(n, o.latest_unit, o.observation_type, measurementSystem)
  return `${shown.value} ${shown.unit}`
}

function HistoryPageContent() {
  const params = useParams()
  const personId = params.personId as string
  const todayYmd = useRefreshingLocalToday()
  const prevTodayRef = useRef(todayYmd)

  const searchParams = useSearchParams()
  const router = useRouter()
  const tabParam = searchParams.get("tab")
  const tab: HistoryTab =
    tabParam === "calendar" ? "calendar"
    // "medication"/"observations" are the old (pre-Summaries-merge) tab param values — keep
    // resolving them so previously-saved/bookmarked links still land on the right pip below.
    : tabParam === "summaries" || tabParam === "medication" || tabParam === "observations" ? "summaries"
    : "activity"
  function selectTab(next: HistoryTab) {
    openedInAppRef.current = false
    router.push(next === "summaries" ? summaryListUrl(summaryKind) : `?tab=${next}`, { scroll: false })
  }

  const summaryParam = searchParams.get("summary")
  const summaryKind: SummaryKind =
    summaryParam === "symptom" || summaryParam === "test_result" ? summaryParam
    : summaryParam === "observation" || tabParam === "observations" ? "observation" : "medication"
  // The record opened from a Summaries list lives in the URL (null = the list itself), so system
  // back, reload and shared links all land on the same view.
  const recordParam = tab === "summaries" ? parseSummaryRecord(searchParams.get("record")) : null
  // True when this page pushed the drill-down entry, so the on-screen back can step back through
  // history like the system back; a deep link has no list entry behind it to return to.
  const openedInAppRef = useRef(false)
  const fallbackIssuedRef = useRef<string | null>(null)
  const selectedRecordKey = summaryKind === "symptom" || summaryKind === "test_result" ? recordParam : null
  function openRecord(kind: SummaryKind, record: string) {
    openedInAppRef.current = true
    router.push(summaryRecordUrl(kind, record), { scroll: false })
  }
  function closeRecord() {
    if (openedInAppRef.current) {
      openedInAppRef.current = false
      router.back()
    } else {
      router.replace(summaryListUrl(summaryKind), { scroll: false })
    }
  }
  // Pills change what the list shows, not where the user has been, so they replace the entry.
  function selectSummaryKind(next: SummaryKind) {
    openedInAppRef.current = false
    router.replace(summaryListUrl(next), { scroll: false })
  }

  const [person, setPerson]     = useState<Person | null>(null)
  const [canDelete, setCanDelete] = useState(false)

  const med = useMedicationHistory({ personId, active: tab === "summaries" && summaryKind === "medication", todayYmd })
  const {
    summaries: medSummaries,
    summaryLoading: medSummaryLoading,
    summaryLoaded: medSummaryLoaded,
    selectedMed,
    selectMed,
    records: medRecords,
    missed: medMissed,
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
  const medRows = useMemo(() => mergeMissedIntoRecords(medRecords, medMissed, medCursor), [medRecords, medMissed, medCursor])

  const recordSummaries = useRecordSummaries({
    personId,
    enabled: tab === "summaries" && (summaryKind === "symptom" || summaryKind === "test_result"),
  })

  const obs = useObservationHistory({ personId, active: tab === "summaries" && summaryKind === "observation", todayYmd })
  const {
    summaries: obsSummaries,
    typeConfigs: obsTypeConfigs,
    summaryLoading: obsSummaryLoading,
    summaryLoaded: obsSummaryLoaded,
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

  // Keep the hooks' selected record in step with the URL (open, back, forward, reload, deep link).
  // A record that no longer exists falls back to its list once the summaries have loaded.
  useEffect(() => {
    if (tab !== "summaries") return
    const fallback = () => {
      const issued = `${summaryKind}:${recordParam}`
      if (fallbackIssuedRef.current === issued) return
      fallbackIssuedRef.current = issued
      router.replace(summaryListUrl(summaryKind), { scroll: false })
    }
    if (summaryKind === "medication") {
      if (!recordParam) { if (selectedMed) selectMed(null); return }
      if (selectedMed && String(selectedMed.id) === recordParam) return
      const found = medSummaries.find(m => String(m.id) === recordParam)
      if (found) selectMed(found)
      else if (medSummaryLoaded && !medSummaryLoading) fallback()
    } else if (summaryKind === "observation") {
      if (!recordParam) { if (selectedObs) selectObs(null); return }
      if (selectedObs && selectedObs.observation_type === recordParam) return
      const found = obsSummaries.find(o => o.observation_type === recordParam)
      if (found) selectObs(found)
      else if (obsSummaryLoaded && !obsSummaryLoading) fallback()
    } else if (recordParam && recordSummaries.loaded && !recordSummaries.loading) {
      const keys = summariseKeys(summaryKind, recordSummaries)
      if (!keys.includes(recordParam)) fallback()
    }
  }, [tab, summaryKind, recordParam, selectedMed, selectMed, medSummaries, medSummaryLoaded, medSummaryLoading,
      selectedObs, selectObs, obsSummaries, obsSummaryLoaded, obsSummaryLoading, recordSummaries, router])

  const [obsGoal, setObsGoal] = useState<ObservationGoal | null>(null)
  // null = loading/not fetched, "error" = fetch failed (fall back to summary value), number = today's total
  const [hydrationTodayMl, setHydrationTodayMl] = useState<number | "error" | null>(null)
  const [measurementSystem, setMeasurementSystem] = useState<MeasurementSystem>("metric")

  // Activity tab
  const highlightId = searchParams.get("highlight")
  // A deep-linked row may be well outside the default 7-day window — widen the initial
  // fetch range so `?highlight=` can actually find it instead of silently no-oping.
  const [feedFrom, setFeedFrom] = useState(() =>
    highlightId ? daysAgo(3650, zonedTodayYmd()) : daysAgo(7, zonedTodayYmd())
  )
  const [feedTo, setFeedTo]     = useState(() => zonedTodayYmd())
  const [feedVisibleCount, setFeedVisibleCount] = useState(DATE_PAGE_SIZE)
  const [feedKindFilter, setFeedKindFilter] = useState<FeedChipKind | "all">("all")
  const [highlightPulseId, setHighlightPulseId] = useState<string | null>(null)

  const activityFeed = useHistoryFeed({ personId, from: feedFrom, to: feedTo, enabled: tab === "activity" })

  // Calendar tab
  const [calendarMonth, setCalendarMonth] = useState(() => zonedTodayYmd().slice(0, 7))
  const [calendarSelectedDay, setCalendarSelectedDay] = useState<string | null>(null)
  const [calendarKindFilter, setCalendarKindFilter] = useState<FeedChipKind | "all">("all")
  const calendarBounds = useMemo(() => monthBounds(calendarMonth), [calendarMonth])
  const calendarFeed = useHistoryFeed({
    personId, from: calendarBounds.from, to: calendarBounds.to, enabled: tab === "calendar", symptomOverlap: true,
  })

  const [personLinks, setPersonLinks] = useState<PersonLink[]>([])
  const linksByDose = useMemo(() => groupLinksBy(personLinks, "dose"), [personLinks])
  const linksBySymptom = useMemo(() => groupLinksBy(personLinks, "symptom"), [personLinks])
  const [medLinkDelta, setMedLinkDelta] = useState<LinkDelta>(EMPTY_LINK_DELTA)
  const [editingMedId, setEditingMedId] = useState<number | null>(null)
  const [medDraft, setMedDraft] = useState<MedDraft | null>(null)
  const [editingObsId, setEditingObsId] = useState<number | null>(null)
  const [obsDraft, setObsDraft] = useState<ObsDraft | null>(null)
  const [editingBpSession, setEditingBpSession] = useState<string | null>(null)
  const [bpDraft, setBpDraft] = useState<BpDraft | null>(null)
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
      setFeedTo(t => (t === prev ? todayYmd : t))
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

  useEffect(() => { setFeedVisibleCount(DATE_PAGE_SIZE) }, [personId, feedFrom, feedTo])

  const filteredFeedRows = useMemo(
    () => (feedKindFilter === "all" ? activityFeed.rows : activityFeed.rows.filter(r => feedChipKind(r.kind) === feedKindFilter)),
    [activityFeed.rows, feedKindFilter]
  )

  const filteredCalendarRows = useMemo(
    () => (calendarKindFilter === "all" ? calendarFeed.rows : calendarFeed.rows.filter(r => feedChipKind(r.kind) === calendarKindFilter)),
    [calendarFeed.rows, calendarKindFilter]
  )
  const calendarGrid = useMemo(
    () => buildCalendarGrid(calendarMonth, filteredCalendarRows, zonedTodayYmd()),
    [calendarMonth, filteredCalendarRows]
  )
  // A symptom is listed on every day its line covers, not only the day it started.
  const calendarDayRows = useMemo(
    () => {
      if (!calendarSelectedDay) return []
      const today = zonedTodayYmd()
      // Symptoms lead the day and test results trail it, as in the Activity feed.
      return orderDayPanelRows(filteredCalendarRows.filter(r => {
        if (r.kind !== "symptom") return feedRowLocalYmd(r) === calendarSelectedDay
        const { start, end } = symptomSpan(r.symptom, today)
        return calendarSelectedDay >= start && calendarSelectedDay <= end
      }))
    },
    [filteredCalendarRows, calendarSelectedDay]
  )

  // Deep-link/anchor: `?highlight=<feedRowId>` scrolls to and briefly highlights that Activity row.
  // The widened `feedFrom` above only guarantees the row is fetched — it can still be past the
  // current client-side page (`feedVisibleCount`), so bump that first and wait a render before
  // querying the DOM.
  useEffect(() => {
    if (tab !== "activity" || !highlightId || activityFeed.loading) return
    const idx = filteredFeedRows.findIndex(r => r.id === highlightId)
    if (idx === -1) return
    if (idx >= feedVisibleCount) {
      setFeedVisibleCount(idx + 1)
      return
    }
    const el = document.querySelector(`[data-feed-row-id="${CSS.escape(highlightId)}"]`)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    setHighlightPulseId(highlightId)
    const t = setTimeout(() => setHighlightPulseId(null), 2500)
    return () => clearTimeout(t)
  }, [tab, highlightId, activityFeed.loading, filteredFeedRows, feedVisibleCount])

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
        reloadFeeds()
        setConfirmDlg(null)
      },
    })
  }

  function deleteObsRecord(id: number) {
    setConfirmDlg({
      ...confirmCopy.deleteObservation,
      onConfirm: async () => {
        await obs.deleteRecord(id)
        reloadFeeds()
        setConfirmDlg(null)
      },
    })
  }

  function deleteTestResult(id: number) {
    setConfirmDlg({
      ...confirmCopy.deleteTestResult,
      onConfirm: async () => {
        await fetch(`/api/test-events?id=${id}`, { method: "DELETE" })
        reloadFeeds()
        setConfirmDlg(null)
      },
    })
  }

  function deleteSymptomEvent(id: number) {
    setConfirmDlg({
      ...confirmCopy.deleteSymptomEvent,
      onConfirm: async () => {
        await fetch(`/api/symptom-events?id=${id}`, { method: "DELETE" })
        reloadFeeds()
        setConfirmDlg(null)
      },
    })
  }

  function reloadFeeds() {
    void Promise.all([activityFeed.reload(), calendarFeed.reload(), recordSummaries.reload(), loadPersonLinks()])
  }

  function loadPersonLinks() {
    return fetch(`/api/symptom-dose-links?person_id=${personId}`, { cache: "no-store" })
      .then(r => (r.ok ? (r.json() as Promise<PersonLink[]>) : []))
      .then(setPersonLinks)
      .catch(() => undefined)
  }

  // Links are small and shown on rows in every tab, so they load once with the page.
  useEffect(() => {
    void loadPersonLinks()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadPersonLinks only closes over personId
  }, [personId])

  /** Stand-in time for the edit draft's day; the picker only needs the local day. */
  function draftDoseIso(d: { date: string }): string {
    try { return localDateAndTimeToUtcIso(d.date, "12:00") } catch { return new Date().toISOString() }
  }

  function startEditMed(r: MedRecord) {
    const { date, time } = splitDateTime(r.recorded_at)
    setEditingMedId(r.id)
    setMedLinkDelta(EMPTY_LINK_DELTA)
    setMedDraft({
      date, time, dosage: r.dosage != null ? String(r.dosage) : "", dosage_unit: r.dosage_unit ?? "Tabs",
      comments: r.comments ?? "", administered_by: r.administered_by ?? "me",
    })
  }

  async function saveMedRecord() {
    if (!editingMedId || !medDraft) return
    const { clearedPrnPushRequests } = await med.saveRecord(editingMedId, medDraft)
    if (clearedPrnPushRequests >= 1) setPrnClearedNoticeOpen(true)
    await saveLinkDelta(personId, { recordId: editingMedId }, medLinkDelta)
    setEditingMedId(null); setMedDraft(null); setMedLinkDelta(EMPTY_LINK_DELTA)
    reloadFeeds()
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
    reloadFeeds()
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
    reloadFeeds()
  }

  function deleteBpPair(sysId: number | null, diaId: number | null) {
    setConfirmDlg({
      ...confirmCopy.deleteBloodPressureReading,
      onConfirm: async () => {
        await obs.deleteBpPair(sysId, diaId)
        reloadFeeds()
        setConfirmDlg(null)
      },
    })
  }

  /** The edit and delete controls at the end of a row, when this person may change records. */
  const rowActions = (name: string, onEdit: () => void, onDelete: () => void) =>
    canDelete ? <EntityRowActions name={name} onEdit={onEdit} onDelete={onDelete} /> : undefined

  function renderFeedRow(row: FeedRow) {
    const rowId = row.id
    const highlighted = highlightPulseId === row.id

    if (row.kind === "medication") {
      const r = row.medication
      if (editingMedId === r.id && medDraft) {
        return (
          <li key={rowId}>
            <MedEditForm
              draft={medDraft}
              onChange={patch => setMedDraft(d => ({ ...d!, ...patch }))}
              onCancel={() => { setEditingMedId(null); setMedDraft(null) }}
              onSave={saveMedRecord}
              personId={personId}
              recordId={r.id}
              recordedAtIso={draftDoseIso(medDraft)}
              onLinkChange={setMedLinkDelta}
            />
          </li>
        )
      }
      return (
        <ListCard
          key={rowId}
          rowId={rowId}
          highlighted={highlighted}
          icon="💊"
          title={r.medication_name}
          meta={[
            // An attached dose says which dose it was for; the badge (if any) says by how much it was off.
            r.timing ? `Taken ${formatTime(r.recorded_at)}` : formatTime(r.recorded_at),
            r.timing ? `for the ${formatSlotHhmm(r.timing.slotHhmm)} dose` : null,
            r.dosage != null ? `${r.dosage} ${r.dosage_unit}` : null,
          ]}
          note={r.comments}
          extras={
            <>
              <FlagBadge flag={row.flag} />
              <AdministeredByBadge administeredBy={r.administered_by} />
              <DoseSymptomChip links={linksByDose.get(r.id) ?? []} />
              {isWithinTimelineWindow(r.recorded_at, Date.now()) && (
                <Link href={`/${personId}?timeline=${encodeURIComponent(row.id)}`} className="fc-card__link">
                  View on timeline
                </Link>
              )}
            </>
          }
          trailing={rowActions(r.medication_name, () => startEditMed(r), () => deleteMedRecord(r.id))}
        />
      )
    }

    if (row.kind === "observation") {
      if (row.observation.kind === "pair") {
        const g = row.observation
        if (editingBpSession === g.session_id && bpDraft) {
          return (
            <li key={rowId}>
              <BpEditForm
                draft={bpDraft}
                onChange={patch => setBpDraft(d => ({ ...d!, ...patch }))}
                onCancel={() => { setEditingBpSession(null); setBpDraft(null) }}
                onSave={saveBpPair}
              />
            </li>
          )
        }
        return (
          <ListCard
            key={rowId}
            rowId={rowId}
            highlighted={highlighted}
            icon="📏"
            title="Blood Pressure"
            meta={[formatTime(g.recorded_at), `${g.sys.value}/${g.dia.value} mmHg`]}
            note={g.comments}
            extras={<FlagBadge flag={row.flag} />}
            trailing={rowActions("Blood Pressure", () => startEditBp(g), () => deleteBpPair(g.sys.id, g.dia.id))}
          />
        )
      }

      const r = row.observation.record
      if (editingObsId === r.id && obsDraft) {
        return (
          <li key={rowId}>
            <ObsEditForm
              draft={obsDraft}
              units={OBS_UNITS[obsDraft.observation_type]}
              onChange={patch => setObsDraft(d => ({ ...d!, ...patch }))}
              onCancel={() => { setEditingObsId(null); setObsDraft(null) }}
              onSave={saveObsRecord}
            />
          </li>
        )
      }
      return (
        <ListCard
          key={rowId}
          rowId={rowId}
          highlighted={highlighted}
          icon="📏"
          title={r.observation_type}
          meta={[formatTime(r.recorded_at), `${r.value_label ? `${r.value_label}: ` : ""}${r.value} ${r.unit}`]}
          note={r.comments}
          extras={<FlagBadge flag={row.flag} />}
          trailing={rowActions(r.observation_type, () => startEditObs(r), () => deleteObsRecord(r.id))}
        />
      )
    }

    if (row.kind === "test_result") {
      const r = row.testResult
      return (
        <ListCard
          key={rowId}
          rowId={rowId}
          highlighted={highlighted}
          icon="🧪"
          title={r.name}
          meta={[r.test_type]}
          note={r.notes}
          extras={
            <>
              <FlagBadge flag={row.flag} />
              {r.values.length > 0 && (
                <ul className="fc-card__values">
                  {r.values.map(v => (
                    <li key={v.metric_name}>
                      {v.metric_name}: {v.value_type === "numeric" ? `${v.limit_qualifier ? `${v.limit_qualifier} ` : ""}${v.numeric_value} ${v.unit ?? ""}`.trim() : v.qualitative_value}
                      {v.flag && <span className="fc-card__flag"> — {v.flag}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {r.attachment_url && <AttachmentLink url={r.attachment_url} />}
            </>
          }
          trailing={rowActions(r.name, () => router.push(`/${personId}/record-test-result?edit=${r.id}`), () => deleteTestResult(r.id))}
        />
      )
    }

    if (row.kind === "dose_missed") {
      const r = row.doseMissed
      return <MissedDoseCard key={rowId} rowId={rowId} highlighted={highlighted} missed={r} timeText={formatTime(r.recorded_at)} />
    }

    if (row.kind === "symptom") {
      const r = row.symptom
      // A symptom is recorded for a date: no time of day is ever shown (null for date-only kinds).
      const symptomTime = feedRowTimeText(row, formatTime)
      return (
        <ListCard
          key={rowId}
          rowId={rowId}
          highlighted={highlighted}
          icon="🤒"
          title={r.label}
          meta={[symptomTime, r.end_date ? formatRange(r.start_date, r.end_date) : `From ${formatDate(r.start_date)}`]}
          note={r.notes}
          extras={
            <>
              <FlagBadge flag={row.flag} />
              {r.is_resolved && <Badge tone="neutral">Resolved</Badge>}
              <SymptomDoseChip links={linksBySymptom.get(r.id) ?? []} />
            </>
          }
          trailing={rowActions(r.label, () => router.push(`/${personId}/record-symptom?edit=${r.id}`), () => deleteSymptomEvent(r.id))}
        />
      )
    }

    return null
  }

  /** Rows grouped under a heading for each day, newest first. */
  function renderFeedList(rows: FeedRow[], visibleCount: number) {
    const groups: { day: string; rows: FeedRow[] }[] = []
    for (const row of rows.slice(0, visibleCount)) {
      const day = instantToZonedYmdHm(row.recorded_at).date
      const last = groups[groups.length - 1]
      if (last && last.day === day) last.rows.push(row)
      else groups.push({ day, rows: [row] })
    }
    return groups.map(g => (
      <section key={g.day} aria-label={formatDate(g.day)} className="fc-history">
        <h2 className="fc-day-heading">{formatDate(g.day)}</h2>
        <CardList>{g.rows.map(renderFeedRow)}</CardList>
      </section>
    ))
  }

  const loadMore = (onClick: () => void, pending: boolean, label = "Load more") => (
    <div>
      <Button variant="secondary" onClick={onClick} pending={pending} pendingLabel="Loading…">{label}</Button>
    </div>
  )

  /** The table of one observation type's records, with each row's edit form in place of the row. */
  function renderObsTable(records: ObsRecord[], withUnitColumn: boolean, id?: string, caption?: string) {
    return (
      <RecordTable
        id={id}
        caption={caption ?? `${selectedObs?.observation_type ?? "Observation"} records`}
        hasActions={canDelete}
        columns={withUnitColumn ? ["Date/Time", "Value", "Unit", "Comments"] : ["Date/Time", "Value", "Comments"]}
        rows={records.map(r => ({
          key: String(r.id),
          cells: withUnitColumn
            ? [formatDateTime(r.recorded_at), r.value, r.unit, r.comments ?? ""]
            : [formatDateTime(r.recorded_at), `${r.value} ${r.unit}`, r.comments ?? ""],
          nowrap: withUnitColumn ? [true, false, false, false] : [true, true, false],
          note: withUnitColumn ? 3 : 2,
          actions: rowActions(r.observation_type, () => startEditObs(r), () => deleteObsRecord(r.id)),
          editing: editingObsId === r.id && obsDraft ? (
            <ObsEditForm
              draft={obsDraft}
              units={OBS_UNITS[obsDraft.observation_type]}
              onChange={patch => setObsDraft(d => ({ ...d!, ...patch }))}
              onCancel={() => { setEditingObsId(null); setObsDraft(null) }}
              onSave={saveObsRecord}
            />
          ) : undefined,
        }))}
      />
    )
  }

  const paginationFooter = selectedObs && isPaginatedObsType(selectedObs.observation_type) && (
    <>
      {obsCursor && loadMore(loadMoreObsRecords, obsLoadingMore)}
      {!obsCursor && obsRecords.length > 0 && <p className="fc-history__end">End of range</p>}
    </>
  )

  if (!person) return <RecordLoadingShell />

  // The record open on Summaries, once it has loaded; until then the trail stops at History.
  const drilledName = (() => {
    if (tab !== "summaries" || !recordParam) return null
    if (summaryKind === "medication") return selectedMed?.name ?? null
    if (summaryKind === "observation") return selectedObs?.observation_type ?? null
    const found = (summaryKind === "symptom"
      ? summariseSymptoms(recordSummaries.symptoms)
      : summariseTestResults(recordSummaries.testResults)
    ).find(x => x.key === recordParam)
    return found?.label ?? null
  })()

  // Written out rather than built with `personTrail`: `closeRecord` reads a ref, which the lint rule
  // refuses to see passed into a function call during render.
  const trail: Crumb[] = [
    { label: person.name, href: `/${personId}` },
    ...(drilledName
      ? [{ label: SUMMARY_KIND_PLURAL[summaryKind], onClick: closeRecord }, { label: drilledName }]
      : [{ label: "History" }]),
  ]

  const detailHeading = (name: string) => (
    <>
      <h2 className="fc-section-title fc-surface-title">{name}</h2>
    </>
  )

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <AppHeader title="History" />

      <PageContainer
        header={<PersonHeader name={person.name} photoUrl={person.photo_url} color={person.color} />}
        trail={trail}
        tabs={<FcTabBar tabs={HISTORY_TABS} active={tab} onSelect={selectTab} />}
      >

        {tab === "summaries" && !recordParam && (
          <ChipGroup legend="Record type" options={SUMMARY_KIND_OPTIONS} value={summaryKind} onChange={selectSummaryKind} />
        )}

        {/* ── MEDICATION SUMMARY ── */}

        {tab === "summaries" && !!recordParam && ((summaryKind === "medication" && !selectedMed) || (summaryKind === "observation" && !selectedObs)) && (
          <p className="fc-admin-note">Loading…</p>
        )}

        {tab === "summaries" && summaryKind === "medication" && !selectedMed && !recordParam && (
          <>
            {medSummaryLoading && <p className="fc-admin-note">Loading…</p>}
            {!medSummaryLoading && medSummaries.length === 0 && (
              <EmptyState icon={EMPTY_STATE_ICONS.noMedications} heading="No medications recorded yet">
                Record a dose and it will appear here.
              </EmptyState>
            )}
            {!medSummaryLoading && medSummaries.length > 0 && (
              <CardList>
                {medSummaries.map(m => (
                  <ListCard
                    key={m.id}
                    icon="💊"
                    title={m.name}
                    href={summaryRecordUrl("medication", String(m.id))}
                    onOpen={() => { openedInAppRef.current = true }}
                    meta={[`Last recorded ${formatDateTime(m.last_recorded)}`, `${m.total_doses} dose${m.total_doses === 1 ? "" : "s"} recorded`]}
                  />
                ))}
              </CardList>
            )}
          </>
        )}

        {tab === "summaries" && summaryKind === "medication" && selectedMed && (
          <>
            {detailHeading(selectedMed.name)}
            <RangeFields from={medFrom} to={medTo} onFrom={setMedFrom} onTo={setMedTo} onApply={loadMedRecords} />

            {medRecordsLoading && <p className="fc-admin-note">Loading…</p>}

            {!medRecordsLoading && (
              <>
                <p className="fc-history__count">
                  {medRecords.length} record{medRecords.length === 1 ? "" : "s"} in selected period
                </p>
                {medRows.length === 0
                  ? (
                    <EmptyState icon={EMPTY_STATE_ICONS.noRecords} heading="No records in this period">
                      Try a wider date range.
                    </EmptyState>
                  )
                  : (
                    <CardList>
                      {medRows.map(row => {
                        if (row.kind === "missed") {
                          return (
                            <MissedDoseCard
                              key={row.missed.id}
                              missed={row.missed}
                              timeText={formatDateTime(row.missed.recorded_at)}
                            />
                          )
                        }
                        const r = row.record
                        if (editingMedId === r.id && medDraft) return (
                          <li key={r.id}>
                            <MedEditForm
                              draft={medDraft}
                              onChange={patch => setMedDraft(d => ({ ...d!, ...patch }))}
                              onCancel={() => { setEditingMedId(null); setMedDraft(null) }}
                              onSave={saveMedRecord}
                              personId={personId}
                              recordId={r.id}
                              recordedAtIso={draftDoseIso(medDraft)}
                              onLinkChange={setMedLinkDelta}
                            />
                          </li>
                        )
                        return (
                          <ListCard
                            key={r.id}
                            icon="💊"
                            title={formatDateTime(r.recorded_at)}
                            meta={[
                              r.dosage != null ? `${r.dosage} ${r.dosage_unit}` : null,
                              r.timing ? `for the ${formatSlotHhmm(r.timing.slotHhmm)} dose` : null,
                            ]}
                            note={r.comments}
                            extras={
                              <>
                                <FlagBadge flag={medicationFlag(r)} />
                                <AdministeredByBadge administeredBy={r.administered_by} />
                                <DoseSymptomChip links={linksByDose.get(r.id) ?? []} />
                              </>
                            }
                            trailing={rowActions(selectedMed.name, () => startEditMed(r), () => deleteMedRecord(r.id))}
                          />
                        )
                      })}
                    </CardList>
                  )
                }
                {medCursor && loadMore(loadMoreMedRecords, medLoadingMore)}
                {!medCursor && medRecords.length > 0 && <p className="fc-history__end">End of range</p>}
              </>
            )}
          </>
        )}

        {/* ── SYMPTOM / TEST RESULT SUMMARIES ── */}

        {tab === "summaries" && (summaryKind === "symptom" || summaryKind === "test_result") && (() => {
          const isSymptom = summaryKind === "symptom"
          const summaries = isSymptom
            ? summariseSymptoms(recordSummaries.symptoms)
            : summariseTestResults(recordSummaries.testResults)
          const selected = summaries.find(x => x.key === selectedRecordKey) ?? null
          const noun = isSymptom ? "symptom" : "test result"

          if (recordSummaries.loading && summaries.length === 0) {
            return <p className="fc-admin-note">Loading…</p>
          }
          if (!selected && recordParam) {
            return <p className="fc-admin-note">Loading…</p>
          }
          if (!selected) {
            return summaries.length === 0 ? (
              <EmptyState
                icon={isSymptom ? EMPTY_STATE_ICONS.noSymptoms : EMPTY_STATE_ICONS.noTestResults}
                heading={`No ${noun}s recorded yet`}
              >
                {isSymptom ? "Record a symptom and it will appear here." : "Record a test result and it will appear here."}
              </EmptyState>
            ) : (
              <CardList>
                {summaries.map(x => (
                  <ListCard
                    key={x.key}
                    icon={isSymptom ? "🤒" : "🧪"}
                    title={x.label}
                    href={summaryRecordUrl(summaryKind, x.key)}
                    onOpen={() => { openedInAppRef.current = true }}
                    meta={[
                      `${isSymptom ? "Last recorded" : "Last tested"} ${formatDate(x.lastDate)}`,
                      isSymptom ? `${x.count} time${x.count === 1 ? "" : "s"} recorded` : `${x.count} result${x.count === 1 ? "" : "s"} recorded`,
                    ]}
                  />
                ))}
              </CardList>
            )
          }

          const rows = isSymptom
            ? toFeedRows([], [], [], symptomsForKey(recordSummaries.symptoms, selected.key))
            : toFeedRows([], [], testResultsForKey(recordSummaries.testResults, selected.key))
          return (
            <>
              {detailHeading(selected.label)}
              <p className="fc-history__count">
                {rows.length} record{rows.length === 1 ? "" : "s"}
              </p>
              {renderFeedList(rows, rows.length)}
            </>
          )
        })()}

        {/* ── OBSERVATION SUMMARY ── */}

        {tab === "summaries" && summaryKind === "observation" && !selectedObs && !recordParam && (
          <>
            {obsSummaryLoading && <p className="fc-admin-note">Loading…</p>}
            {!obsSummaryLoading && obsSummaries.length === 0 && (
              <EmptyState icon={EMPTY_STATE_ICONS.noObservations} heading="No observations recorded yet">
                Record an observation and it will appear here.
              </EmptyState>
            )}
            {!obsSummaryLoading && obsSummaries.length > 0 && (
              <CardList>
                {obsSummaries.map(o => {
                  const cfg = obsConfigByLower.get(o.observation_type.trim().toLowerCase())
                  const thresh = cfg?.stale_after_hours ?? null
                  const stale = isStaleReading(o.last_recorded, thresh)
                  return (
                    <ListCard
                      key={o.observation_type}
                      icon="📏"
                      title={o.observation_type}
                      href={summaryRecordUrl("observation", o.observation_type)}
                      onOpen={() => { openedInAppRef.current = true }}
                      meta={[
                        `Last recorded ${formatDateTime(o.last_recorded)}`,
                        `${o.total_count} observation${o.total_count === 1 ? "" : "s"} recorded`,
                        stale && thresh != null ? `Stale: older than the suggested ${formatStaleThresholdHours(thresh)} between readings` : null,
                      ]}
                      extras={
                        <>
                          <span className="fc-card__big">{latestValueText(o, hydrationTodayMl, measurementSystem)}</span>
                          {stale && <Badge tone="warning">Stale</Badge>}
                        </>
                      }
                    />
                  )
                })}
              </CardList>
            )}
          </>
        )}

        {tab === "summaries" && summaryKind === "observation" && selectedObs && (() => {
          const selCfg = obsConfigByLower.get(selectedObs.observation_type.trim().toLowerCase())
          const staleHours = selCfg?.stale_after_hours ?? null
          const showStale = staleHours != null && staleHours > 0 && isStaleReading(selectedObs.last_recorded, staleHours)

          const header = (
            <>
              {detailHeading(selectedObs.observation_type)}
              {showStale && (
                <Banner kind="warning" lead="Stale reading">
                  The latest value is older than this type&apos;s suggested refresh window ({formatStaleThresholdHours(staleHours!)}).
                  Recorded {formatDateTime(selectedObs.last_recorded)}.
                </Banner>
              )}
              <RangeFields
                from={obsFrom}
                to={obsTo}
                onFrom={setObsFrom}
                onTo={setObsTo}
                onApply={() => { loadObsRecords(); loadObsChartData() }}
                extra={[7, 30, 90].map(days => (
                  <Button key={days} variant="secondary" onClick={() => applyObsPreset(days)}>Last {days} days</Button>
                ))}
              />
            </>
          )

          return (
            <>
              {header}

              {obsRecordsLoading && <p className="fc-admin-note">Loading…</p>}

              {selectedObs.observation_type === "Hydration" && (
                <>
                  {obsChartLoading
                    ? <p className="fc-admin-note">Loading…</p>
                    : (
                      <>
                        <div className="fc-chart-card">
                          <HydrationBarChart
                            data={obsChartData.map(r => ({ date: r.recorded_at, value: r.value, unit: r.unit }))}
                            goalMl={obsGoal?.goal_type === "daily_min" ? obsGoal.target_value : undefined}
                            describedById={obsRecords.length > 0 ? "hydration-chart-data-table" : undefined}
                          />
                        </div>
                        <p className="fc-history__count">
                          {obsChartData.length} record{obsChartData.length === 1 ? "" : "s"} in selected period
                        </p>
                      </>
                    )
                  }
                  {!obsRecordsLoading && obsRecords.length > 0 && (
                    <>
                      {renderObsTable(obsRecords, false, "hydration-chart-data-table", "Hydration records for the chart")}
                      {paginationFooter}
                    </>
                  )}
                </>
              )}

              {OBS_HISTORY_CHART_TYPES.has(selectedObs.observation_type) && (
                <>
                  {obsChartLoading
                    ? <p className="fc-admin-note">Loading…</p>
                    : (
                      <>
                        {obsChartData.length < 2
                          ? <p className="fc-section-copy fc-surface-copy">Not enough data to display a chart — need at least 2 observations.</p>
                          : (
                            <div className="fc-chart-card">
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
                          )
                        }
                        <p className="fc-history__count">
                          {obsChartData.length} observation{obsChartData.length === 1 ? "" : "s"} in selected period
                        </p>
                      </>
                    )
                  }
                  {!obsRecordsLoading && obsRecords.length > 0 && (
                    <>
                      {renderObsTable(obsRecords, false, "obs-line-chart-data-table", `${selectedObs.observation_type} records for the chart`)}
                      {paginationFooter}
                    </>
                  )}
                </>
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
                  <>
                    {pairedAsc.length >= 2 ? (
                      <div className="fc-chart-card">
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
                      <p className="fc-section-copy fc-surface-copy">
                        Not enough paired readings for a chart — need at least two complete systolic/diastolic pairs.
                      </p>
                    )}
                    <p className="fc-history__count">
                      {bpRows.length} reading{bpRows.length === 1 ? "" : "s"} in selected period
                    </p>
                    {bpRows.length === 0 ? (
                      <EmptyState icon={EMPTY_STATE_ICONS.noRecords} heading="No readings in this period">
                        Try a wider date range.
                      </EmptyState>
                    ) : (
                      <RecordTable
                        id="bp-chart-data-table"
                        caption="Blood pressure records for the chart"
                        hasActions={canDelete}
                        columns={["Date/Time", "Value", "Comments"]}
                        rows={bpRows.map(row => {
                          if (row.kind === "pair") {
                            return {
                              key: `bp-pair-${row.session_id}`,
                              cells: [formatDateTime(row.recorded_at), `${row.sys.value}/${row.dia.value} mmHg`, row.comments ?? ""],
                              nowrap: [true, true, false],
                              note: 2,
                              actions: rowActions("Blood Pressure", () => startEditBp(row), () => deleteBpPair(row.sys.id, row.dia.id)),
                              editing: editingBpSession === row.session_id && bpDraft ? (
                                <BpEditForm
                                  draft={bpDraft}
                                  onChange={patch => setBpDraft(d => ({ ...d!, ...patch }))}
                                  onCancel={() => { setEditingBpSession(null); setBpDraft(null) }}
                                  onSave={saveBpPair}
                                />
                              ) : undefined,
                            }
                          }
                          const r = row.record
                          return {
                            key: `bp-single-${r.id}`,
                            cells: [formatDateTime(r.recorded_at), formatBpSingle(r), r.comments ?? ""],
                            nowrap: [true, true, false],
                            note: 2,
                            actions: rowActions("Blood Pressure", () => startEditObs(r), () => deleteObsRecord(r.id)),
                            editing: editingObsId === r.id && obsDraft ? (
                              <ObsEditForm
                                draft={obsDraft}
                                units={OBS_UNITS["Blood Pressure"] ?? ["mmHg"]}
                                onChange={patch => setObsDraft(d => ({ ...d!, ...patch }))}
                                onCancel={() => { setEditingObsId(null); setObsDraft(null) }}
                                onSave={saveObsRecord}
                              />
                            ) : undefined,
                          }
                        })}
                      />
                    )}
                  </>
                )
              })()}

              {!obsRecordsLoading && !OBS_HISTORY_CHART_TYPES.has(selectedObs.observation_type) && selectedObs.observation_type !== "Blood Pressure" && selectedObs.observation_type !== "Hydration" && (
                <>
                  <p className="fc-history__count">
                    {obsRecords.length} observation{obsRecords.length === 1 ? "" : "s"} loaded
                  </p>
                  {obsRecords.length === 0
                    ? (
                      <EmptyState icon={EMPTY_STATE_ICONS.noRecords} heading="No observations in this period">
                        Try a wider date range.
                      </EmptyState>
                    )
                    : (
                      <>
                        {renderObsTable(obsRecords, true)}
                        {paginationFooter}
                      </>
                    )
                  }
                </>
              )}
            </>
          )
        })()}

        {/* ── ACTIVITY TAB ── */}

        {tab === "activity" && (
          <>
            <RangeFields from={feedFrom} to={feedTo} onFrom={setFeedFrom} onTo={setFeedTo} />
            <FeedKindChips value={feedKindFilter} onChange={setFeedKindFilter} />

            {activityFeed.loading && <p className="fc-admin-note">Loading…</p>}

            {!activityFeed.loading && (
              <>
                <p className="fc-history__count">
                  {filteredFeedRows.length} entr{filteredFeedRows.length === 1 ? "y" : "ies"} in selected period
                </p>
                {filteredFeedRows.length === 0
                  ? (
                    <EmptyState icon={EMPTY_STATE_ICONS.noRecords} heading="No records in this period">
                      Try a wider date range, or record something new.
                    </EmptyState>
                  )
                  : renderFeedList(filteredFeedRows, feedVisibleCount)
                }
                {filteredFeedRows.length > feedVisibleCount && loadMore(
                  () => setFeedVisibleCount(c => c + DATE_PAGE_SIZE),
                  false,
                  `Load more (${filteredFeedRows.length - feedVisibleCount} older)`,
                )}
                {filteredFeedRows.length > 0 && filteredFeedRows.length <= feedVisibleCount && (
                  <p className="fc-history__end">End of range</p>
                )}
              </>
            )}
          </>
        )}

        {/* ── CALENDAR TAB ── */}

        {tab === "calendar" && (
          <HistoryCalendar
            month={calendarMonth}
            onShiftMonth={delta => { setCalendarMonth(m => shiftMonth(m, delta)); setCalendarSelectedDay(null) }}
            kindFilter={calendarKindFilter}
            onKindFilter={v => { setCalendarKindFilter(v); setCalendarSelectedDay(null) }}
            loading={calendarFeed.loading}
            grid={calendarGrid}
            selectedDay={calendarSelectedDay}
            onSelectDay={setCalendarSelectedDay}
            dayRows={calendarDayRows}
            renderRow={renderFeedRow}
          />
        )}
      </PageContainer>

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

function RecordLoadingShell() {
  return (
    <div className="flex flex-col flex-1">
      <AppHeader title="History" />
      <PageContainer>
        <p className="fc-admin-note">Loading…</p>
      </PageContainer>
      <AppFooter />
    </div>
  )
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<div className="flex flex-col flex-1 min-h-0 fc-surface-app" />}>
      <HistoryPageContent />
    </Suspense>
  )
}
