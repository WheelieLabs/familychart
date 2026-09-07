// SPDX-License-Identifier: AGPL-3.0-only

import { normaliseMedicationDosageUnitAlias } from "@/lib/medication/medication-units"
import type { ImportRecordType } from "@/lib/spreadsheet-import"

export type ImportCategory = "medications" | "observations" | "both"

export type FieldMapping =
  | "date" | "time"
  | "medication_name" | "dose"
  | "weight_kg" | "comments" | "ignore"
  | "observation_type" | "obs_value" | "obs_unit"
  | "bp_systolic" | "bp_diastolic"

export interface MappedRow {
  _idx: number
  record_type: ImportRecordType
  date: string | null
  time: string | null
  comments: string | null
  medication_name: string | null
  dosage: number | null
  dosage_unit: string | null
  weight_kg: number | null
  observation_type: string | null
  obs_value: number | null
  obs_unit: string | null
  bp_systolic: number | null
  bp_diastolic: number | null
}

export type DraftMapped = Omit<MappedRow, "record_type">

export function parseDate(val: unknown): string | null {
  if (val == null || val === "") return null
  if (val instanceof Date) {
    const y = val.getFullYear()
    const m = String(val.getMonth() + 1).padStart(2, "0")
    const d = String(val.getDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
  }
  const s = String(val).trim()
  // DD/MM/YYYY or DD/MM/YY (Australian)
  const au = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (au) {
    const y = au[3].length === 2
      ? (parseInt(au[3]) > 50 ? `19${au[3]}` : `20${au[3]}`)
      : au[3]
    return `${y}-${au[2].padStart(2, "0")}-${au[1].padStart(2, "0")}`
  }
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return null
}

export function parseTime(val: unknown): string | null {
  if (val == null || val === "") return null
  if (val instanceof Date) {
    return `${String(val.getHours()).padStart(2, "0")}:${String(val.getMinutes()).padStart(2, "0")}`
  }
  const s = String(val).trim()
  const m = s.match(/^(\d{1,2}):(\d{2})/)
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`
  return null
}

export function parseOptionalNumber(val: unknown): number | null {
  if (val == null || val === "") return null
  if (typeof val === "number" && !Number.isNaN(val)) return val
  const n = parseFloat(String(val).replace(/,/g, "").trim())
  return Number.isFinite(n) ? n : null
}

export function parseDose(val: unknown): { dosage: number | null; dosage_unit: string | null } {
  if (val == null || val === "") return { dosage: null, dosage_unit: null }
  const s = String(val).trim()
  const m = s.match(/^(\d+\.?\d*)\s*([a-zA-Z]+)?$/)
  if (!m) return { dosage: null, dosage_unit: null }
  const dosage = parseFloat(m[1])
  const raw = m[2]
  const dosage_unit = raw ? normaliseMedicationDosageUnitAlias(raw) : null
  return { dosage, dosage_unit }
}

export function suggestMapping(header: string, importCat: ImportCategory): FieldMapping {
  const h = header.toLowerCase().trim()
  if (h.includes("systolic") || (h.includes("sys") && importCat !== "medications")) return "bp_systolic"
  if (h.includes("diastolic") || (h.includes("dia") && h.length <= 5)) return "bp_diastolic"

  if (
    h.includes("date")
    && !h.includes("update")
    && !h.includes("created")
  ) return "date"
  if (h.includes("time")) return "time"

  if (importCat !== "observations") {
    if (h.includes("med") || h.includes("drug")) return "medication_name"
    if (h.includes("dose") || h.includes("dosage")) return "dose"
    if (h.includes("weight") || h === "kg" || h.includes(" kg")) return "weight_kg"
  }

  if (importCat !== "medications") {
    if (h.includes("observation") || h === "type" || h === "vital") return "observation_type"
    if (h.includes("value") || h === "reading" || h === "result") return "obs_value"
    if (h.includes("unit") && !h.includes("dose")) return "obs_unit"
    if (
      h.includes("weight")
      || h === "wt"
      || (importCat === "observations" && h === "kg")
    ) return "observation_type"
  }

  if (h.includes("comment") || h.includes("note")) return "comments"
  return "ignore"
}

/** Pad ragged rows, coerce empty cells to null, trim trailing blank rows. */
export function normalizeSpreadsheetMatrix(raw: readonly (readonly unknown[])[]): unknown[][] {
  let maxCols = 0
  for (const row of raw) {
    maxCols = Math.max(maxCols, row.length)
  }

  const rows: unknown[][] = []
  for (const row of raw) {
    const cells: unknown[] = []
    for (let i = 0; i < maxCols; i++) {
      const v = row[i]
      cells.push(v === undefined || v === "" ? null : v)
    }
    rows.push(cells)
  }

  while (rows.length && rows[rows.length - 1]!.every(c => c == null || c === "")) {
    rows.pop()
  }
  return rows
}

export function parseCsvToMatrix(text: string): unknown[][] {
  const rows: unknown[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false

  const pushRow = () => {
    rows.push(row.map(c => {
      const t = c.trim()
      return t === "" ? null : t
    }))
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        }
        else {
          inQuotes = false
        }
      }
      else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ",") {
      row.push(field); field = ""
      continue
    }
    if (ch === "\n") {
      row.push(field); field = ""; pushRow()
      continue
    }
    if (ch === "\r") continue
    field += ch
  }
  row.push(field)
  if (row.some(c => c !== "")) pushRow()

  while (rows.length && rows[rows.length - 1]?.every(c => c == null || c === "")) rows.pop()
  return rows
}

export function applyColumnMapping(
  headers: string[],
  mapping: Record<string, FieldMapping>,
  rawRows: unknown[][],
): DraftMapped[] {
  const colIndex: Partial<Record<FieldMapping, number>> = {}
  headers.forEach((h, i) => {
    const f = mapping[h]
    if (f && f !== "ignore" && colIndex[f] === undefined) colIndex[f] = i
  })

  const get = (f: FieldMapping, row: unknown[]) => {
    const i = colIndex[f]
    return i !== undefined ? row[i] : null
  }

  return rawRows.map((row, idx) => {
    const { dosage, dosage_unit } = parseDose(get("dose", row))
    const wRaw = get("weight_kg", row)
    const weight_kg = wRaw != null && wRaw !== "" ? parseOptionalNumber(wRaw) : null

    return {
      _idx: idx,
      date: parseDate(get("date", row)),
      time: parseTime(get("time", row)),
      medication_name: get("medication_name", row) ? String(get("medication_name", row)).trim() : null,
      dosage,
      dosage_unit,
      weight_kg: weight_kg != null && !Number.isNaN(weight_kg) ? weight_kg : null,
      comments: get("comments", row) ? String(get("comments", row)).trim() : null,
      observation_type: get("observation_type", row) ? String(get("observation_type", row)).trim() : null,
      obs_value: parseOptionalNumber(get("obs_value", row)),
      obs_unit: get("obs_unit", row) ? String(get("obs_unit", row)).trim() : null,
      bp_systolic: parseOptionalNumber(get("bp_systolic", row)),
      bp_diastolic: parseOptionalNumber(get("bp_diastolic", row)),
    }
  })
}

export function classifyRecordType(importCat: ImportCategory, r: DraftMapped): ImportRecordType {
  const hasMed = !!(r.medication_name?.trim())
  const hasBp = r.bp_systolic != null && r.bp_diastolic != null
  const hasObs = !!(r.observation_type?.trim()) && r.obs_value != null

  if (importCat === "medications") return "medication"
  if (importCat === "observations") {
    if (hasBp) return "blood_pressure_pair"
    return "observation"
  }
  if (hasBp && !hasMed) return "blood_pressure_pair"
  if (hasMed) return "medication"
  if (hasObs) return "observation"
  if (hasBp) return "blood_pressure_pair"
  return "observation"
}

export function withRecordTypes(importCat: ImportCategory, drafts: DraftMapped[]): MappedRow[] {
  return drafts.map(r => ({ ...r, record_type: classifyRecordType(importCat, r) }))
}

export function rowIsImportable(r: MappedRow): boolean {
  if (!r.date) return false
  switch (r.record_type) {
    case "medication":
      return !!(r.medication_name?.trim())
    case "observation":
      return !!(r.observation_type?.trim()) && r.obs_value != null
    case "blood_pressure_pair":
      return r.bp_systolic != null && r.bp_diastolic != null
    default:
      return false
  }
}
