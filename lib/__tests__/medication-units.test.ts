// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest"
import {
  MEDICATION_DOSAGE_UNITS,
  normaliseMedicationDosageUnitAlias,
} from "@/lib/medication/medication-units"

describe("MEDICATION_DOSAGE_UNITS", () => {
  it("includes applications", () => {
    expect(MEDICATION_DOSAGE_UNITS).toContain("applications")
  })

  it("maps import aliases for applications", () => {
    expect(normaliseMedicationDosageUnitAlias("application")).toBe("applications")
    expect(normaliseMedicationDosageUnitAlias("applications")).toBe("applications")
    expect(normaliseMedicationDosageUnitAlias("APPLICATION")).toBe("applications")
  })
})
