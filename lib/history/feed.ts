// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared discriminated union for the History screen's Live Feed / Calendar views. A real
 * 5-member closed union — not a plugin registry — because there is no other such pattern in
 * this codebase.
 */

import { groupBpRows, type BpGroupedRow } from "@/lib/blood-pressure-pairing"
import { timingBadgeLabel } from "@/lib/medication/dose-timing-display"
import type { MedRecord } from "@/lib/medication/medication-history"
import type { DoseMissedSummary } from "@/lib/medication/dose-missed-history"
import type { ObsRecord } from "@/lib/observation/observation-history"
import type { TestResultSummary } from "@/lib/test-results/test-result-history"
import type { SymptomEventSummary } from "@/lib/symptoms/symptom-history"

export type FeedKind = "medication" | "observation" | "symptom" | "test_result" | "dose_missed"

/**
 * A confirmed-missed external dose is a medication-side record, so it shares the Medication
 * filter chip and calendar dot rather than adding a fifth chip.
 */
export type FeedChipKind = Exclude<FeedKind, "dose_missed">

export function feedChipKind(kind: FeedKind): FeedChipKind {
  return kind === "dose_missed" ? "medication" : kind
}

export interface FeedFlag {
  level: "amber" | "red" | "info" | "neutral"
  label: string
}

interface FeedRowCommon {
  id: string
  recorded_at: string
  flag: FeedFlag | null
}

export type FeedRow =
  | (FeedRowCommon & { kind: "medication"; medication: MedRecord })
  | (FeedRowCommon & { kind: "observation"; observation: BpGroupedRow<ObsRecord> })
  | (FeedRowCommon & { kind: "symptom"; symptom: SymptomEventSummary })
  | (FeedRowCommon & { kind: "test_result"; testResult: TestResultSummary })
  | (FeedRowCommon & { kind: "dose_missed"; doseMissed: DoseMissedSummary })

/**
 * Medication's native scale is the timing stored against its slot: only exceptions are flagged, and
 * the label says by how much ("41 min late", "38 min early"). On time shows nothing.
 */
export function medicationFlag(r: Pick<MedRecord, "timing">): FeedFlag | null {
  const label = timingBadgeLabel(r.timing)
  if (!label || !r.timing) return null
  return { level: r.timing.result === "late" ? "amber" : "info", label }
}

/**
 * No native per-record severity scale exists for observations yet (dashboard staleness is a
 * separate, summary-level concept, not per-record) — always null for now. Kept as its own
 * function so it's an obvious seam if that changes.
 */
export function observationFlag(): FeedFlag | null {
  return null
}

/**
 * Test result's native scale is the qualitative "differs from expected" flag transcribed per
 * value from the report in hand — any flagged value on the event maps the whole row down to
 * amber. Reference ranges/flags are never pre-populated, so there's no red tier.
 */
export function testResultFlag(r: TestResultSummary): FeedFlag | null {
  return r.values.some(v => v.flag) ? { level: "amber", label: "Differs from expected" } : null
}

/**
 * Symptom's native scale is the 1-5 severity recorded with it, shown as "Severity n/5":
 * 4-5 -> red, 2-3 -> amber, 1 -> neutral (a recorded severity of 1 is not an alert).
 */
export function symptomFlag(r: SymptomEventSummary): FeedFlag {
  const label = `Severity ${r.severity}/5`
  if (r.severity >= 4) return { level: "red", label }
  if (r.severity >= 2) return { level: "amber", label }
  return { level: "neutral", label }
}

function obsGroupRecordedAt(g: BpGroupedRow<ObsRecord>): string {
  return g.kind === "pair" ? g.recorded_at : g.record.recorded_at
}

function obsGroupId(g: BpGroupedRow<ObsRecord>): string {
  return g.kind === "pair" ? `bp:${g.session_id}` : `obs:${g.record.id}`
}

export function toFeedRows(
  medRecords: MedRecord[],
  obsRecords: ObsRecord[],
  testResults: TestResultSummary[] = [],
  symptomEvents: SymptomEventSummary[] = [],
  doseMissed: DoseMissedSummary[] = [],
): FeedRow[] {
  const bpObs = obsRecords.filter(o => o.observation_type === "Blood Pressure")
  const otherObs = obsRecords.filter(o => o.observation_type !== "Blood Pressure")

  const obsGroups: BpGroupedRow<ObsRecord>[] = [
    ...groupBpRows(bpObs, "detail"),
    ...otherObs.map((record): BpGroupedRow<ObsRecord> => ({ kind: "single", record })),
  ]

  const rows: FeedRow[] = [
    ...medRecords.map((medication): FeedRow => ({
      kind: "medication",
      id: `med:${medication.id}`,
      recorded_at: medication.recorded_at,
      flag: medicationFlag(medication),
      medication,
    })),
    ...obsGroups.map((observation): FeedRow => ({
      kind: "observation",
      id: obsGroupId(observation),
      recorded_at: obsGroupRecordedAt(observation),
      flag: observationFlag(),
      observation,
    })),
    ...testResults.map((testResult): FeedRow => ({
      kind: "test_result",
      id: `test:${testResult.id}`,
      recorded_at: testResult.date,
      flag: testResultFlag(testResult),
      testResult,
    })),
    ...symptomEvents.map((symptom): FeedRow => ({
      kind: "symptom",
      id: `symptom:${symptom.id}`,
      recorded_at: symptom.start_date,
      flag: symptomFlag(symptom),
      symptom,
    })),
    // A confirmed miss is history only, so it carries no flag (it must not read as an alert).
    ...doseMissed.map((missed): FeedRow => ({
      kind: "dose_missed",
      id: `dose-missed:${missed.id}`,
      recorded_at: missed.recorded_at,
      flag: null,
      doseMissed: missed,
    })),
  ]

  rows.sort(compareFeedRows)
  return rows
}

/**
 * Position of a kind within its day: symptoms (a date, not a time) lead, test results (tall cards)
 * trail, and everything else sits between in time order.
 */
export function dayRank(kind: FeedKind): 0 | 1 | 2 {
  return kind === "symptom" ? 0 : kind === "test_result" ? 2 : 1
}

function localDayNumber(iso: string): number {
  const d = new Date(iso)
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

/**
 * Newest day first (device local days). Within a day: symptoms, then the day's other records
 * newest-first, then test results; ties fall back to the row id so equal rows never swap between loads.
 */
export function compareFeedRows(a: FeedRow, b: FeedRow): number {
  return (
    localDayNumber(b.recorded_at) - localDayNumber(a.recorded_at) ||
    dayRank(a.kind) - dayRank(b.kind) ||
    new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime() ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  )
}

/** Orders the rows listed for one day (a symptom can span the day): symptoms first, test results last, feed order otherwise. */
export function orderDayPanelRows(rows: FeedRow[]): FeedRow[] {
  return [...rows].sort((a, b) => dayRank(a.kind) - dayRank(b.kind))
}

/** Symptoms and test results are recorded for a day, not a time: they are stored at a local midnight or midday stand-in. */
export function isDateOnlyKind(kind: FeedKind): boolean {
  return kind === "symptom" || kind === "test_result"
}

/**
 * The time of day to print on a row, or null for a date-only kind so a stand-in time ("12:00 AM")
 * can never appear on a symptom. `format` is the screen's own time formatter.
 */
export function feedRowTimeText(row: Pick<FeedRow, "kind" | "recorded_at">, format: (iso: string) => string): string | null {
  return isDateOnlyKind(row.kind) ? null : format(row.recorded_at)
}
