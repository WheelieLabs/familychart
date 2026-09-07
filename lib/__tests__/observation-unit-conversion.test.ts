// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import {
  canonicalUnitForObservationType,
  defaultUnitForObservationType,
} from "@/lib/observation/observation-types"
import {
  convertObservationValue,
  roundDisplayObservationValue,
  toDisplayObservation,
  toMl,
} from "@/lib/observation/observation-unit-conversion"
import { isValidMeasurementSystem } from "@/lib/settings/registry"

describe("defaultUnitForObservationType", () => {
  it("picks metric defaults", () => {
    expect(defaultUnitForObservationType("Weight", "metric")).toBe("kg")
    expect(defaultUnitForObservationType("Height", "metric")).toBe("cm")
    expect(defaultUnitForObservationType("Temperature", "metric")).toBe("°C")
    expect(defaultUnitForObservationType("Blood Glucose", "metric")).toBe("mmol/L")
    expect(defaultUnitForObservationType("Hydration", "metric")).toBe("mL")
  })

  it("picks imperial defaults", () => {
    expect(defaultUnitForObservationType("Weight", "imperial")).toBe("lb")
    expect(defaultUnitForObservationType("Height", "imperial")).toBe("in")
    expect(defaultUnitForObservationType("Temperature", "imperial")).toBe("°F")
    expect(defaultUnitForObservationType("Blood Glucose", "imperial")).toBe("mg/dL")
    expect(defaultUnitForObservationType("Hydration", "imperial")).toBe("mL")
  })

  it("leaves single-unit types unchanged", () => {
    expect(defaultUnitForObservationType("Heart Rate", "imperial")).toBe("bpm")
    expect(defaultUnitForObservationType("SpO2", "metric")).toBe("%")
  })
})

describe("isValidMeasurementSystem", () => {
  it("accepts metric and imperial only", () => {
    expect(isValidMeasurementSystem("metric")).toBe(true)
    expect(isValidMeasurementSystem("imperial")).toBe(true)
    expect(isValidMeasurementSystem("us")).toBe(false)
    expect(isValidMeasurementSystem("")).toBe(false)
  })
})

describe("observation unit conversion", () => {
  it("converts weight round-trip kg ↔ lb", () => {
    const lb = convertObservationValue(70, "kg", "lb", "Weight")
    expect(lb).not.toBeNull()
    const back = convertObservationValue(lb!, "lb", "kg", "Weight")
    expect(back).toBeCloseTo(70, 5)
  })

  it("converts height through cm (m and in)", () => {
    expect(convertObservationValue(1.8, "m", "cm", "Height")).toBeCloseTo(180, 5)
    expect(convertObservationValue(180, "cm", "in", "Height")).toBeCloseTo(70.866, 2)
  })

  it("converts temperature °C ↔ °F", () => {
    expect(convertObservationValue(37, "°C", "°F", "Temperature")).toBeCloseTo(98.6, 5)
    expect(convertObservationValue(98.6, "°F", "°C", "Temperature")).toBeCloseTo(37, 5)
  })

  it("converts blood glucose mmol/L ↔ mg/dL", () => {
    const mg = convertObservationValue(5.5, "mmol/L", "mg/dL", "Blood Glucose")
    expect(mg).toBeCloseTo(99.1, 0)
    expect(convertObservationValue(mg!, "mg/dL", "mmol/L", "Blood Glucose")).toBeCloseTo(5.5, 5)
  })

  it("normalises hydration to mL", () => {
    expect(toMl(0.25, "L")).toBe(250)
    expect(toMl(250, "mL")).toBe(250)
  })

  it("normalises mixed-unit series to locale canonical for display", () => {
    const a = toDisplayObservation(154.32, "lb", "Weight", "metric")
    expect(a.unit).toBe("kg")
    expect(a.value).toBeCloseTo(70, 1)

    const b = toDisplayObservation(70, "kg", "Weight", "imperial")
    expect(b.unit).toBe("lb")
    expect(roundDisplayObservationValue(b.value, b.unit)).toBeCloseTo(154.3, 0)
  })

  it("reports canonical units per measurement system", () => {
    expect(canonicalUnitForObservationType("Weight", "metric")).toBe("kg")
    expect(canonicalUnitForObservationType("Weight", "imperial")).toBe("lb")
    expect(canonicalUnitForObservationType("Heart Rate", "metric")).toBeNull()
  })
})
