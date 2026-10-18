// SPDX-License-Identifier: AGPL-3.0-only

import { validateRecordTiming } from "@/lib/medication/medication-record-validation"

export interface SymptomEventWriteInput {
  label: unknown
  start_date: unknown
  end_date?: unknown
  severity: unknown
  is_resolved?: unknown
  notes?: unknown
}

export interface SymptomEventWriteFields {
  label: string
  startDate: string
  endDate: string | null
  severity: number
  isResolved: boolean
  notes: string | null
}

function requiredTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function optionalTrimmedString(value: unknown): string | null {
  const s = requiredTrimmedString(value)
  return s === "" ? null : s
}

/**
 * Validates a `symptom_events` write. `start_date`/`end_date` reuse `validateRecordTiming`'s
 * bounds (no future-dating beyond skew, not implausibly old) — the same timing precedent as
 * dose/test-event recording. `end_date`, when given, must not precede `start_date`.
 */
export function validateSymptomEventWrite(
  input: SymptomEventWriteInput,
): ({ ok: true } & SymptomEventWriteFields) | { ok: false; error: string } {
  const label = requiredTrimmedString(input.label)
  if (!label) return { ok: false, error: "label is required" }

  const start = validateRecordTiming(input.start_date)
  if (!start.ok) return { ok: false, error: start.error }

  let endDate: string | null = null
  const endRaw = optionalTrimmedString(input.end_date)
  if (endRaw !== null) {
    const end = validateRecordTiming(endRaw)
    if (!end.ok) return { ok: false, error: end.error }
    if (new Date(end.recordedAt).getTime() < new Date(start.recordedAt).getTime()) {
      return { ok: false, error: "end_date cannot be before start_date" }
    }
    endDate = end.recordedAt
  }

  const severityRaw = input.severity
  const severity =
    typeof severityRaw === "number" ? severityRaw
    : typeof severityRaw === "string" ? Number(severityRaw)
    : NaN
  if (!Number.isInteger(severity) || severity < 1 || severity > 5) {
    return { ok: false, error: "severity must be an integer between 1 and 5" }
  }

  return {
    ok: true,
    label,
    startDate: start.recordedAt,
    endDate,
    severity,
    isResolved: input.is_resolved === true,
    notes: optionalTrimmedString(input.notes),
  }
}
