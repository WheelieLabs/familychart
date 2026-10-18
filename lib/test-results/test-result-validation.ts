// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"
import { findTestMetricConfig } from "@/lib/test-results/test-metric-meta"
import type { LimitQualifier } from "@/lib/domain-types"
import { validateRecordTiming } from "@/lib/medication/medication-record-validation"

export interface TestEventWriteInput {
  /** Optional since the Record Test Result redesign (the form asks for a single Name). */
  test_type?: unknown
  name: unknown
  date: unknown
  ordered_by?: unknown
  notes?: unknown
}

export interface TestEventWriteFields {
  testType: string
  name: string
  date: string
  orderedBy: string | null
  notes: string | null
}

function requiredTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

const LIMIT_QUALIFIERS: readonly string[] = ["<", "<=", ">", ">="]

function optionalTrimmedString(value: unknown): string | null {
  const s = requiredTrimmedString(value)
  return s === "" ? null : s
}

/**
 * Validates a `test_events` write (name/date required; test_type/ordered_by/notes optional).
 * An absent test_type is stored as "" (the column predates the single-Name form and is NOT NULL).
 */
export function validateTestEventWrite(
  input: TestEventWriteInput,
): ({ ok: true } & TestEventWriteFields) | { ok: false; error: string } {
  const testType = requiredTrimmedString(input.test_type)

  const name = requiredTrimmedString(input.name)
  if (!name) return { ok: false, error: "name is required" }

  const timing = validateRecordTiming(input.date)
  if (!timing.ok) return { ok: false, error: timing.error }

  return {
    ok: true,
    testType,
    name,
    date: timing.recordedAt,
    orderedBy: optionalTrimmedString(input.ordered_by),
    notes: optionalTrimmedString(input.notes),
  }
}

export interface TestResultValueWriteInput {
  metric_name: unknown
  value_type: unknown
  numeric_value?: unknown
  qualitative_value?: unknown
  unit?: unknown
  reference_range?: unknown
  flag?: unknown
  /** `<`, `<=`, `>` or `>=`; numeric results only. */
  limit_qualifier?: unknown
  /**
   * Caller-asserted escape hatch for a metric not in the curated catalogue (the catalogue has
   * no manager-facing "add a metric" path — see ADR-0012 — so a report can contain a value with
   * no matching row). When true, `metric_name` is accepted as free text instead of being
   * resolved against `test_metric_config`.
   */
  other?: unknown
}

export interface TestResultValueWriteFields {
  metricName: string
  valueType: "numeric" | "qualitative"
  numericValue: number | null
  qualitativeValue: string | null
  unit: string | null
  referenceRange: string | null
  flag: string | null
  limitQualifier: LimitQualifier | null
  isOther: boolean
}

/**
 * Validates one `test_result_values` row. Unless `other` is set, `metric_name` must resolve to
 * an active row in the curated `test_metric_config` catalogue (mirrors `validateObservationWrite`).
 * Reference range and flag are transcribed as provided, never derived here — a hardcoded
 * "normal" range or severity would be FamilyChart asserting its own clinical judgement, which
 * the app avoids.
 */
export function validateTestResultValueWrite(
  db: Database.Database,
  input: TestResultValueWriteInput,
  options?: { requireActive?: boolean },
): ({ ok: true } & TestResultValueWriteFields) | { ok: false; error: string } {
  const metricName = requiredTrimmedString(input.metric_name)
  if (!metricName) return { ok: false, error: "metric_name is required" }

  const isOther = input.other === true
  let resolvedMetricName = metricName
  if (!isOther) {
    const config = findTestMetricConfig(db, metricName)
    // Same rule as observations: restore accepts a switched-off metric, not an unknown one.
    if (!config) {
      return {
        ok: false,
        error: options?.requireActive === false
          ? `Unknown test metric "${metricName}"`
          : `Unknown or inactive test metric "${metricName}"`,
      }
    }
    if (!config.is_active && options?.requireActive !== false) {
      return { ok: false, error: `Unknown or inactive test metric "${metricName}"` }
    }
    resolvedMetricName = config.metric_name
  }

  if (input.value_type !== "numeric" && input.value_type !== "qualitative") {
    return { ok: false, error: "value_type must be \"numeric\" or \"qualitative\"" }
  }

  const qualifierRaw = optionalTrimmedString(input.limit_qualifier)
  if (qualifierRaw !== null && input.value_type !== "numeric") {
    return { ok: false, error: "limit_qualifier is only valid for a numeric result" }
  }
  if (qualifierRaw !== null && !LIMIT_QUALIFIERS.includes(qualifierRaw)) {
    return { ok: false, error: "limit_qualifier must be one of <, <=, >, >=" }
  }

  if (input.value_type === "numeric") {
    const numeric =
      typeof input.numeric_value === "number"
        ? input.numeric_value
        : typeof input.numeric_value === "string"
          ? Number(input.numeric_value)
          : NaN
    if (!Number.isFinite(numeric)) {
      return { ok: false, error: "numeric_value must be a finite number" }
    }
    return {
      ok: true,
      metricName: resolvedMetricName,
      valueType: "numeric",
      numericValue: numeric,
      qualitativeValue: null,
      unit: optionalTrimmedString(input.unit),
      referenceRange: optionalTrimmedString(input.reference_range),
      flag: optionalTrimmedString(input.flag),
      limitQualifier: qualifierRaw as LimitQualifier | null,
      isOther,
    }
  }

  const qualitativeValue = optionalTrimmedString(input.qualitative_value)
  if (!qualitativeValue) {
    return { ok: false, error: "qualitative_value is required for a qualitative result" }
  }
  return {
    ok: true,
    metricName: resolvedMetricName,
    valueType: "qualitative",
    numericValue: null,
    qualitativeValue,
    unit: optionalTrimmedString(input.unit),
    referenceRange: optionalTrimmedString(input.reference_range),
    flag: optionalTrimmedString(input.flag),
    limitQualifier: null,
    isOther,
  }
}
