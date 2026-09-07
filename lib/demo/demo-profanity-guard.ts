// SPDX-License-Identifier: AGPL-3.0-only

import { NextResponse } from "next/server"
import { isDemoModeActive } from "@/lib/demo/demo-mode"
import {
  fieldsContainLocalProfanity,
  fieldsContainProfanityViaApi,
} from "@/lib/demo/demo-profanity"
import type { ImportRecord } from "@/lib/spreadsheet-import"

export const DEMO_PROFANITY_ERROR =
  "This content is not allowed in the demo environment."

/** Reject write payloads in armed demo mode when free-text fields contain profanity. */
export async function rejectDemoProfanity(
  ...fields: (string | null | undefined)[]
): Promise<NextResponse | null> {
  if (!isDemoModeActive()) return null
  if (fieldsContainLocalProfanity(fields)) {
    return NextResponse.json({ error: DEMO_PROFANITY_ERROR }, { status: 400 })
  }
  if (await fieldsContainProfanityViaApi(fields)) {
    return NextResponse.json({ error: DEMO_PROFANITY_ERROR }, { status: 400 })
  }
  return null
}

function importRecordTextFields(rec: ImportRecord): (string | null | undefined)[] {
  if (rec.record_type === "observation") {
    return [rec.observation_type, rec.unit, rec.comments]
  }
  if (rec.record_type === "blood_pressure_pair") {
    return [rec.comments]
  }
  return [rec.medication_name, rec.comments, rec.dosage_unit]
}

/** Reject spreadsheet import rows that contain profanity in demo mode. */
export async function rejectDemoImportProfanity(
  records: ImportRecord[],
): Promise<NextResponse | null> {
  if (!isDemoModeActive()) return null
  for (const rec of records) {
    const fields = importRecordTextFields(rec)
    if (fieldsContainLocalProfanity(fields)) {
      return NextResponse.json({ error: DEMO_PROFANITY_ERROR }, { status: 400 })
    }
    if (await fieldsContainProfanityViaApi(fields)) {
      return NextResponse.json({ error: DEMO_PROFANITY_ERROR }, { status: 400 })
    }
  }
  return null
}
