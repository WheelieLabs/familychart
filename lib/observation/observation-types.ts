// SPDX-License-Identifier: AGPL-3.0-only

import type { MeasurementSystem } from "@/lib/settings/registry"

/** Labels stored in `observations.observation_type` */

export const OBSERVATION_TYPE_LABELS = [
  "Weight",
  "Height",
  "Temperature",
  "Blood Pressure",
  "Heart Rate",
  "SpO2",
  "Blood Glucose",
  "Respirations",
  "Head Circumference",
  "Hydration",
] as const

export type ObservationTypeLabel = (typeof OBSERVATION_TYPE_LABELS)[number]

const LABEL_SET = new Set<string>(OBSERVATION_TYPE_LABELS)

export function isValidObservationTypeLabel(s: string): s is ObservationTypeLabel {
  return LABEL_SET.has(s)
}

export interface ObservationUiType {
  label: ObservationTypeLabel
  units: string[]
  defaultUnit: string
  step: string
  maxAgeYears?: number
  isStatic?: boolean
  isPaired?: boolean
}

export const OBSERVATION_UI_TYPES: ObservationUiType[] = [
  { label: "Weight", units: ["kg", "lb"], defaultUnit: "kg", step: "0.1" },
  { label: "Height", units: ["cm", "m", "in"], defaultUnit: "cm", step: "0.1" },
  { label: "Temperature", units: ["°C", "°F"], defaultUnit: "°C", step: "0.1" },
  { label: "Blood Pressure", units: ["mmHg"], defaultUnit: "mmHg", step: "1", isPaired: true },
  { label: "Heart Rate", units: ["bpm"], defaultUnit: "bpm", step: "1" },
  { label: "SpO2", units: ["%"], defaultUnit: "%", step: "1" },
  { label: "Blood Glucose", units: ["mmol/L", "mg/dL"], defaultUnit: "mmol/L", step: "0.1" },
  { label: "Respirations", units: ["breaths/min"], defaultUnit: "breaths/min", step: "1" },
  { label: "Head Circumference", units: ["cm"], defaultUnit: "cm", step: "0.1", maxAgeYears: 3, isStatic: true },
  { label: "Hydration", units: ["mL", "L"], defaultUnit: "mL", step: "1" },
]

/** True for observation types that record two values (e.g. systolic/diastolic). */
export function isPairedObservationType(observationType: string): boolean {
  return OBSERVATION_UI_TYPES.find(t => t.label === observationType)?.isPaired === true
}

/** Unit dropdown when recording: prefer catalogue row if present, else config typical_unit only. */
export function unitOptionsForObservationType(observationType: string, typicalUnit: string | null): string[] {
  const hit = OBSERVATION_UI_TYPES.find(t => t.label === observationType)
  if (hit) return [...hit.units]
  const t = typicalUnit?.trim()
  return t ? [t] : [""]
}

export function stepForObservationType(observationType: string): string {
  return OBSERVATION_UI_TYPES.find(t => t.label === observationType)?.step ?? "0.1"
}

/**
 * Locale-appropriate default unit for the record form.
 * Does not use DB `typical_unit` — catalogue defaults come from code + measurement system.
 */
export function defaultUnitForObservationType(
  observationType: string,
  measurementSystem: MeasurementSystem,
): string {
  switch (observationType) {
    case "Weight":
      return measurementSystem === "imperial" ? "lb" : "kg"
    case "Height":
      return measurementSystem === "imperial" ? "in" : "cm"
    case "Temperature":
      return measurementSystem === "imperial" ? "°F" : "°C"
    case "Blood Glucose":
      return measurementSystem === "imperial" ? "mg/dL" : "mmol/L"
    case "Hydration":
      return "mL"
    default: {
      const hit = OBSERVATION_UI_TYPES.find(t => t.label === observationType)
      return hit?.defaultUnit ?? ""
    }
  }
}

/** Display-layer canonical unit for convertible types; null for single-unit types. */
export function canonicalUnitForObservationType(
  observationType: string,
  measurementSystem: MeasurementSystem,
): string | null {
  switch (observationType) {
    case "Weight":
      return measurementSystem === "imperial" ? "lb" : "kg"
    case "Height":
      return measurementSystem === "imperial" ? "in" : "cm"
    case "Temperature":
      return measurementSystem === "imperial" ? "°F" : "°C"
    case "Blood Glucose":
      return measurementSystem === "imperial" ? "mg/dL" : "mmol/L"
    case "Hydration":
      return "mL"
    default:
      return null
  }
}

