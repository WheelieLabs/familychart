// SPDX-License-Identifier: AGPL-3.0-only

import type { MeasurementSystem } from "@/lib/settings/registry"
import { canonicalUnitForObservationType } from "@/lib/observation/observation-types"

export { canonicalUnitForObservationType, defaultUnitForObservationType } from "@/lib/observation/observation-types"

function normUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/\s+/g, "")
}

/** Convert hydration volume to millilitres (L → mL). */
export function toMl(value: number, unit: string): number {
  const u = normUnit(unit)
  if (u === "l") return value * 1000
  return value
}

function toKg(value: number, unit: string): number | null {
  const u = normUnit(unit)
  if (u === "kg") return value
  if (u === "lb" || u === "lbs") return value * 0.45359237
  return null
}

function fromKg(kg: number, toUnit: string): number | null {
  const u = normUnit(toUnit)
  if (u === "kg") return kg
  if (u === "lb" || u === "lbs") return kg / 0.45359237
  return null
}

function toCm(value: number, unit: string): number | null {
  const u = normUnit(unit)
  if (u === "cm") return value
  if (u === "m") return value * 100
  if (u === "in" || u === "inch" || u === "inches") return value * 2.54
  return null
}

function fromCm(cm: number, toUnit: string): number | null {
  const u = normUnit(toUnit)
  if (u === "cm") return cm
  if (u === "m") return cm / 100
  if (u === "in" || u === "inch" || u === "inches") return cm / 2.54
  return null
}

function toCelsius(value: number, unit: string): number | null {
  const u = normUnit(unit)
  if (u === "°c" || u === "c" || u === "celsius") return value
  if (u === "°f" || u === "f" || u === "fahrenheit") return (value - 32) * (5 / 9)
  return null
}

function fromCelsius(c: number, toUnit: string): number | null {
  const u = normUnit(toUnit)
  if (u === "°c" || u === "c" || u === "celsius") return c
  if (u === "°f" || u === "f" || u === "fahrenheit") return c * (9 / 5) + 32
  return null
}

/** mmol/L ↔ mg/dL (standard clinical factor 18.0182). */
const GLUCOSE_MG_PER_MMOL = 18.0182

function toMmolL(value: number, unit: string): number | null {
  const u = normUnit(unit)
  if (u === "mmol/l") return value
  if (u === "mg/dl") return value / GLUCOSE_MG_PER_MMOL
  return null
}

function fromMmolL(mmol: number, toUnit: string): number | null {
  const u = normUnit(toUnit)
  if (u === "mmol/l") return mmol
  if (u === "mg/dl") return mmol * GLUCOSE_MG_PER_MMOL
  return null
}

/**
 * Convert an observation value between units of the same type.
 * Returns null when the type/units are not convertible.
 */
export function convertObservationValue(
  value: number,
  fromUnit: string,
  toUnit: string,
  observationType: string,
): number | null {
  if (!Number.isFinite(value)) return null
  if (normUnit(fromUnit) === normUnit(toUnit)) return value

  switch (observationType) {
    case "Weight": {
      const kg = toKg(value, fromUnit)
      return kg == null ? null : fromKg(kg, toUnit)
    }
    case "Height":
    case "Head Circumference": {
      const cm = toCm(value, fromUnit)
      return cm == null ? null : fromCm(cm, toUnit)
    }
    case "Temperature": {
      const c = toCelsius(value, fromUnit)
      return c == null ? null : fromCelsius(c, toUnit)
    }
    case "Blood Glucose": {
      const mmol = toMmolL(value, fromUnit)
      return mmol == null ? null : fromMmolL(mmol, toUnit)
    }
    case "Hydration": {
      const ml = toMl(value, fromUnit)
      const target = normUnit(toUnit)
      if (target === "ml") return ml
      if (target === "l") return ml / 1000
      return null
    }
    default:
      return null
  }
}

/**
 * Convert a stored value+unit to the locale canonical unit for display.
 * Returns the original pair when the type is not convertible or conversion fails.
 */
export function toDisplayObservation(
  value: number,
  unit: string,
  observationType: string,
  measurementSystem: MeasurementSystem,
): { value: number; unit: string } {
  const target = canonicalUnitForObservationType(observationType, measurementSystem)
  if (!target) return { value, unit }
  const converted = convertObservationValue(value, unit, target, observationType)
  if (converted == null) return { value, unit }
  return { value: converted, unit: target }
}

/** Round display values sensibly for charts/summaries. */
export function roundDisplayObservationValue(value: number, unit: string): number {
  const u = normUnit(unit)
  if (u === "bpm" || u === "%" || u === "breaths/min" || u === "mmhg" || u === "ml") {
    return Math.round(value)
  }
  if (u === "mg/dl" || u === "lb" || u === "lbs" || u === "in") {
    return Math.round(value * 10) / 10
  }
  return Math.round(value * 100) / 100
}
