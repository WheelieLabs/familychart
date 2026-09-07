// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import Link from "next/link"
import { useState, useEffect, useRef, useCallback } from "react"
import { readSheet } from "read-excel-file/browser"
import AppHeader from "@/components/AppHeader"
import AppFooter from "@/components/AppFooter"
import type { Person } from "@/lib/domain-types"
import { MEDICATION_DOSAGE_UNITS } from "@/lib/medication/medication-units"
import type { ImportRecord, ImportRecordType } from "@/lib/spreadsheet-import"
import {
  applyColumnMapping,
  normalizeSpreadsheetMatrix,
  parseCsvToMatrix,
  rowIsImportable,
  suggestMapping,
  withRecordTypes,
  type FieldMapping,
  type ImportCategory,
  type MappedRow,
} from "@/lib/spreadsheet-parse"

const FIELD_LABELS: Record<FieldMapping, string> = {
  date:             "Date",
  time:             "Time",
  medication_name:  "Medication",
  dose:             "Dose (number + unit)",
  weight_kg:        "Weight (kg)",
  comments:         "Comments",
  observation_type: "Observation Type",
  obs_value:        "Observation value",
  obs_unit:         "Observation unit",
  bp_systolic:      "BP systolic",
  bp_diastolic:     "BP diastolic",
  ignore:           "Ignore column",
}

type RowEdit = Partial<Omit<MappedRow, "_idx">>

interface ImportResult {
  imported: number
  observations_created: number
  errors: string[]
  person_name: string
}

const UNITS = [...MEDICATION_DOSAGE_UNITS]

async function fileToMatrix(file: File): Promise<unknown[][]> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  const buf = await file.arrayBuffer()

  if (ext === "csv") return parseCsvToMatrix(new TextDecoder("utf-8").decode(buf))
  if (ext === "xls") throw new Error(".xls (Excel 97–2003) is not supported — save as .xlsx or CSV")

  const raw = await readSheet(buf)
  if (!raw.length) throw new Error("Spreadsheet has no worksheets")
  return normalizeSpreadsheetMatrix(raw)
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const [mounted, setMounted]                   = useState(false)
  const [isMobile, setIsMobile]                 = useState(false)
  const [canImport, setCanImport]             = useState<boolean | null>(null)
  const [people, setPeople]                   = useState<Person[]>([])
  const [medications, setMedications]          = useState<string[]>([])
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null)
  const [file, setFile]                       = useState<File | null>(null)
  const [dragOver, setDragOver]               = useState(false)
  const [error, setError]                     = useState<string | null>(null)

  const [importCategory, setImportCategory]   = useState<ImportCategory>("medications")

  const [headers, setHeaders]                 = useState<string[]>([])
  const [sampleRows, setSampleRows]           = useState<unknown[][]>([])
  const [allRawRows, setAllRawRows]           = useState<unknown[][]>([])
  const [mapping, setMapping]                 = useState<Record<string, FieldMapping>>({})

  const [mappedRows, setMappedRows]         = useState<MappedRow[]>([])
  const [edits, setEdits]                     = useState<Record<number, RowEdit>>({})
  const [selected, setSelected]               = useState<Set<number>>(new Set())
  const [importing, setImporting]             = useState(false)
  const [importResult, setImportResult]       = useState<ImportResult | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const resetMappingState = useCallback(() => {
    setHeaders([]); setSampleRows([]); setAllRawRows([])
    setMapping({}); setMappedRows([]); setEdits({})
    setSelected(new Set()); setImportResult(null)
  }, [])

  useEffect(() => {
    setMounted(true)
    setIsMobile(window.innerWidth < 1024)
  }, [])

  useEffect(() => {
    fetch("/api/me")
      .then(r => r.json())
      .then((me: { role: string | null }) => {
        setCanImport(me.role === "admin" || me.role === "manager")
      })
  }, [])

  useEffect(() => {
    fetch("/api/people")
      .then(r => r.json())
      .then((d: Person[]) => setPeople(d))
    fetch("/api/medications")
      .then(r => r.json())
      .then((d: { name: string }[]) => setMedications(d.map(m => m.name)))
  }, [])

  async function handleFileSelect(f: File) {
    const ext = f.name.split(".").pop()?.toLowerCase()
    if (!["xlsx", "csv"].includes(ext ?? "")) {
      setError("Unsupported file type. Please upload .xlsx or .csv")
      return
    }
    if (f.size > 10 * 1024 * 1024) {
      setError("File too large (max 10MB)")
      return
    }
    setError(null)
    setFile(f)
    resetMappingState()

    try {
      const rows = await fileToMatrix(f)
      if (!rows.length) {
        setError("Spreadsheet appears to be empty"); return
      }

      const hdrs = (rows[0] as unknown[]).map(h => h != null ? String(h).trim() : "")
      const dataRows = rows.slice(1)

      setHeaders(hdrs)
      setSampleRows(dataRows.slice(0, 5))
      setAllRawRows(dataRows)
      const initial: Record<string, FieldMapping> = {}
      hdrs.forEach(h => { initial[h] = suggestMapping(h, importCategory) })
      setMapping(initial)
    } catch (e) {
      setError((e as Error).message)
      setFile(null)
    }
  }

  function remapSuggestionsForCategory(cat: ImportCategory) {
    if (!headers.length) return
    const next: Record<string, FieldMapping> = {}
    headers.forEach(h => { next[h] = suggestMapping(h, cat) })
    setMapping(next)
  }

  function handlePersonSelect(id: number) {
    setSelectedPersonId(id)
    resetMappingState()
    setFile(null)
    setError(null)
  }

  function confirmMapping() {
    if (!selectedPersonId) return
    const drafts = applyColumnMapping(headers, mapping, allRawRows).filter(r => !!(
      r.date || r.medication_name || r.observation_type
      || r.obs_value != null || r.bp_systolic != null || r.weight_kg != null
    ))

    const baseRows = withRecordTypes(importCategory, drafts)
    setEdits({})
    setError(null)

    setMappedRows(baseRows)
    setSelected(new Set(baseRows.filter(rowIsImportable).map(r => r._idx)))
  }

  function mergeRow(r: MappedRow): MappedRow {
    const e = edits[r._idx]
    return e ? { ...r, ...e } : r
  }

  function updateEdit(idx: number, field: keyof RowEdit, value: unknown) {
    setEdits(v => ({ ...v, [idx]: { ...(v[idx] ?? {}), [field]: value } }))
  }

  async function handleImport() {
    if (!selectedPersonId || selected.size === 0) return
    setImporting(true)
    setError(null)

    const records: ImportRecord[] = []
    for (const r0 of mappedRows.filter(r => selected.has(r._idx))) {
      const r = mergeRow(r0)
      if (!rowIsImportable(r)) continue
      if (r.record_type === "medication") {
        records.push({
          record_type: "medication",
          date:            r.date!,
          time:            r.time,
          medication_name: r.medication_name!,
          dosage:          r.dosage,
          dosage_unit:     r.dosage_unit,
          weight_kg:       r.weight_kg,
          comments:        r.comments,
        })
      }
      else if (r.record_type === "observation") {
        records.push({
          record_type:      "observation",
          date:             r.date!,
          time:             r.time,
          observation_type: r.observation_type!,
          value:            r.obs_value!,
          unit:             r.obs_unit ?? "",
          comments:         r.comments,
        })
      }
      else {
        records.push({
          record_type: "blood_pressure_pair",
          date:        r.date!,
          time:        r.time,
          systolic:    r.bp_systolic!,
          diastolic:   r.bp_diastolic!,
          comments:    r.comments,
        })
      }
    }

    const res = await fetch("/api/import/confirm", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        person_id:    selectedPersonId,
        import_type:  importCategory,
        records,
      }),
    })
    const data = await res.json() as ImportResult & { error?: string }
    if (res.ok) {
      setImportResult(data)
      setMappedRows([]); setEdits({}); setSelected(new Set())
    }
    else {
      setError(`Import failed: ${data.error ?? "Unknown error"}`)
    }
    setImporting(false)
  }

  const visibleMapped = mappedRows.filter(r => {
    const m = mergeRow(r)
    return !!(m.date || m.medication_name || m.observation_type || m.bp_systolic != null || m.weight_kg != null)
  })

  if (!mounted) return null

  if (isMobile) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <AppHeader title="Import Records" />
        <div className="flex-1 flex flex-col items-center justify-center bg-fc-blue p-8 text-center">
          <div className="text-white text-5xl mb-6">🖥️</div>
          <h1 className="text-white text-2xl font-bold mb-4">Desktop Required</h1>
          <p className="text-white/80 text-lg leading-relaxed mb-8">
            This screen requires a desktop browser.<br />
            Please access FamilyChart on a PC to use the import tool.
          </p>
          <Link href="/" className="bg-white text-fc-blue font-bold px-6 py-3 rounded-xl hover:bg-gray-100 inline-block">
            Back to Home
          </Link>
        </div>
        <AppFooter />
      </div>
    )
  }

  if (canImport === false) {
    return (
      <div className="flex flex-col flex-1">
        <AppHeader title="Import Records" />
        <div className="flex-1 flex items-center justify-center bg-fc-blue">
          <div className="bg-white rounded-2xl p-10 text-center max-w-sm">
            <div className="text-4xl mb-4">🔒</div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Access Required</h2>
            <p className="text-gray-500 text-sm">The import tool requires Manager or Admin access.</p>
          </div>
        </div>
        <AppFooter />
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <AppHeader title="Import Records" />
      <div className="flex flex-1 overflow-hidden">

        {/* Left panel */}
        <div className="w-80 shrink-0 bg-fc-panel border-r border-gray-200 flex flex-col overflow-y-auto p-5 gap-5">

          <div>
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">1. Select Person</h2>
            <div className="flex flex-col gap-2">
              {people.map(p => {
                const initials = p.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
                const sel = selectedPersonId === p.id
                return (
                  <button key={p.id} onClick={() => handlePersonSelect(p.id)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 transition-colors text-left
                      ${sel ? "border-fc-blue bg-fc-blue/10" : "border-transparent bg-white hover:border-gray-300"}`}>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 overflow-hidden"
                         style={{ backgroundColor: p.color }}>
                      {p.photo_url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={p.photo_url} alt={p.name} className="w-full h-full object-cover" />
                        : <span className="text-white font-bold text-sm">{initials}</span>}
                    </div>
                    <span className="font-semibold text-gray-800 flex-1">{p.name}</span>
                    {sel && <span className="text-fc-blue text-sm">✓</span>}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Import type</h2>
            <div className="flex flex-col gap-1.5 bg-white rounded-xl border border-gray-200 p-2">
              {(
                [
                  ["medications", "Medications"],
                  ["observations", "Observations"],
                  ["both", "Both"],
                ] satisfies [ImportCategory, string][]
              ).map(([val, label]) => (
                <label key={val} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="import_cat"
                    checked={importCategory === val}
                    onChange={() => {
                      setImportCategory(val)
                      remapSuggestionsForCategory(val)
                    }}
                    className="accent-fc-blue"
                  />
                  <span className="text-sm text-gray-800">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Upload file</h2>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f) }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors
                ${dragOver ? "border-fc-blue bg-fc-blue/5" : "border-gray-300 hover:border-fc-blue hover:bg-fc-blue/5"}`}>
              <input ref={fileInputRef} type="file" accept=".xlsx,.csv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); e.target.value = "" }} />
              {file ? (
                <>
                  <div className="text-2xl mb-1">📄</div>
                  <div className="font-semibold text-gray-800 text-sm truncate">{file.name}</div>
                  <div className="text-xs text-gray-500 mt-1">{(file.size / 1024).toFixed(0)} KB · {allRawRows.length} rows</div>
                </>
              ) : (
                <>
                  <div className="text-2xl mb-1">📁</div>
                  <div className="text-sm text-gray-600">Drop file here or click to browse</div>
                  <div className="text-xs text-gray-400 mt-1">.xlsx, .csv · Max 10MB</div>
                </>
              )}
            </div>
          </div>

          {error && (
            <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="flex-1 overflow-hidden flex flex-col bg-white">
          {importResult ? (
            <ImportSuccess result={importResult} onReset={() => {
              setImportResult(null); setFile(null); resetMappingState(); setError(null)
            }} />
          ) : mappedRows.length > 0 ? (
            <PreviewTable
              importCategory={importCategory}
              visibleRows={visibleMapped}
              mergeRow={mergeRow}
              selected={selected}
              setSelected={setSelected}
              medications={medications}
              updateEdit={updateEdit}
              importing={importing}
              onImport={handleImport}
              onBack={() => { setMappedRows([]); setEdits({}); setSelected(new Set()) }}
            />
          ) : headers.length > 0 ? (
            <ColumnMapper
              importCategory={importCategory}
              headers={headers}
              sampleRows={sampleRows}
              mapping={mapping}
              setMapping={setMapping}
              onConfirm={() => confirmMapping()}
              disabled={!selectedPersonId}
            />
          ) : (
            <Instructions />
          )}
        </div>
      </div>
      <AppFooter />
    </div>
  )
}

// ── Instructions ─────────────────────────────────────────────────────────────

function Instructions() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-12">
      <div className="max-w-lg w-full">
        <div className="text-4xl mb-6 text-center">📋</div>
        <h2 className="text-2xl font-bold text-gray-700 mb-6 text-center">How to Import</h2>
        <ol className="space-y-4 text-gray-600">
          {[
            ["Select a person", "Choose who the records belong to from the left panel"],
            ["Choose import type", "Medications, observations, or mixed rows"],
            ["Upload spreadsheet", "Drag or browse — columns are mapped in the next step"],
            ["Map the columns", "Date plus medication and/or observation or blood-pressure columns"],
            ["Review and import", "Uncheck or edit rows, then confirm"],
          ].map(([title, desc], i) => (
            <li key={i} className="flex gap-3">
              <span className="font-bold text-fc-blue shrink-0 text-lg">{i + 1}.</span>
              <div>
                <p className="font-semibold">{title}</p>
                <p className="text-sm text-gray-400">{desc}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="text-sm text-gray-400 mt-8 text-center">Supported: .xlsx and CSV</p>
      </div>
    </div>
  )
}

// ── Column mapper ─────────────────────────────────────────────────────────────

interface ColumnMapperProps {
  importCategory: ImportCategory
  headers: string[]
  sampleRows: unknown[][]
  mapping: Record<string, FieldMapping>
  setMapping: (m: Record<string, FieldMapping>) => void
  onConfirm: () => void
  disabled: boolean
}

function ColumnMapper({
  importCategory, headers, sampleRows, mapping, setMapping,
  onConfirm, disabled,
}: ColumnMapperProps) {
  const mappedFields = Object.values(mapping).filter(v => v !== "ignore")
  const hasDate           = mappedFields.includes("date")
  const hasMedication     = mappedFields.includes("medication_name")
  const hasObsType        = mappedFields.includes("observation_type")
  const hasObsVal         = mappedFields.includes("obs_value")
  const hasBpPair         = mappedFields.includes("bp_systolic") && mappedFields.includes("bp_diastolic")

  let valid = hasDate && !disabled
  if (importCategory === "medications") valid = valid && hasMedication
  else if (importCategory === "observations") valid = valid && (hasBpPair || (hasObsType && hasObsVal))
  else valid = valid && (hasMedication || hasBpPair || (hasObsType && hasObsVal))

  let hintMsg = ""
  if (!valid && !disabled) {
    if (!hasDate) hintMsg = "Map a Date column."
    else if (importCategory === "medications") hintMsg = "Map Medication."
    else if (importCategory === "observations") {
      hintMsg = "Map BP systolic+dias or Observation Type+value."
    }
    else {
      hintMsg = "Map at least Medication path, BP pair, or Observation Type+value."
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-6 pt-5 pb-3 border-b border-gray-100 shrink-0">
        <h2 className="text-xl font-bold text-gray-800">Map Columns</h2>
        <p className="text-sm text-gray-500 mt-1">
          Match each spreadsheet column using the dropdowns below.
        </p>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left px-3 py-2.5 border border-gray-200 font-semibold text-gray-700 w-40">Column</th>
              <th className="text-left px-3 py-2.5 border border-gray-200 font-semibold text-gray-700">Sample values</th>
              <th className="text-left px-3 py-2.5 border border-gray-200 font-semibold text-gray-700 w-52">Maps to</th>
            </tr>
          </thead>
          <tbody>
            {headers.map((h, colIdx) => {
              const samples = sampleRows
                .map(row => row[colIdx])
                .filter(v => v != null && v !== "")
                .slice(0, 3)
                .map(v => v instanceof Date ? v.toLocaleDateString("en-AU") : String(v))

              return (
                <tr key={`${h}-${colIdx}`} className="hover:bg-gray-50">
                  <td className="px-3 py-2 border border-gray-200 font-medium text-gray-800">{h || `(${colIdx + 1})`}</td>
                  <td className="px-3 py-2 border border-gray-200 text-gray-500 text-xs">
                    {samples.length ? samples.join(" · ") : <span className="italic text-gray-300">no data</span>}
                  </td>
                  <td className="px-3 py-2 border border-gray-200">
                    <select
                      value={mapping[h] ?? "ignore"}
                      onChange={e => setMapping({ ...mapping, [h]: e.target.value as FieldMapping })}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white text-gray-800">
                      {(Object.entries(FIELD_LABELS) as [FieldMapping, string][]).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {!valid && hintMsg && (
          <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            {hintMsg}
          </div>
        )}

        {disabled && (
          <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-700">
            Select a person from the left panel before confirming the mapping.
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 px-6 py-4 shrink-0 flex justify-end">
        <button
          onClick={onConfirm}
          disabled={disabled || !valid}
          className="bg-fc-blue text-white font-bold px-8 py-2.5 rounded-xl text-sm
                     disabled:opacity-50 disabled:cursor-not-allowed
                     hover:bg-fc-blue-mid active:bg-fc-blue-dark transition-colors flex items-center gap-2">
          Use This Mapping →
        </button>
      </div>
    </div>
  )
}

// ── Preview table ─────────────────────────────────────────────────────────────

interface PreviewTableProps {
  importCategory: ImportCategory
  visibleRows: MappedRow[]
  mergeRow: (r: MappedRow) => MappedRow
  selected: Set<number>
  setSelected: (s: Set<number>) => void
  medications: string[]
  updateEdit: (idx: number, field: keyof RowEdit, value: unknown) => void
  importing: boolean
  onImport: () => void
  onBack: () => void
}

function PreviewTable({
  importCategory, visibleRows, mergeRow, selected, setSelected,
  medications, updateEdit, importing, onImport, onBack,
}: PreviewTableProps) {
  const hasWeight = visibleRows.some(r => mergeRow(r).weight_kg != null)
  const showObsCols = importCategory !== "medications"
  const showMedCols = importCategory !== "observations"

  function importable() {
    return visibleRows.filter(r => rowIsImportable(mergeRow(r)))
  }

  function selectAll() { setSelected(new Set(importable().map(r => r._idx))) }
  function deselectAll() { setSelected(new Set()) }

  const nImportable = importable().length

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse min-w-max">
          <thead className="sticky top-0 bg-gray-100 z-10 shadow-sm">
            <tr>
              <th className="px-3 py-2.5 border-b border-gray-200 w-10">
                <input type="checkbox"
                  checked={selected.size > 0 && selected.size === nImportable && nImportable > 0}
                  onChange={e => e.target.checked ? selectAll() : deselectAll()}
                  className="w-4 h-4 accent-fc-blue" />
              </th>
              {(showObsCols && importCategory === "both") && (
                <th className="px-3 py-2.5 text-left border-b border-gray-200 text-gray-700 font-semibold whitespace-nowrap">Record</th>
              )}
              <th className="px-3 py-2.5 text-left border-b border-gray-200 text-gray-700 font-semibold whitespace-nowrap">Date</th>
              <th className="px-3 py-2.5 text-left border-b border-gray-200 text-gray-700 font-semibold whitespace-nowrap">Time</th>
              {showMedCols && (
                <>
                  <th className="px-3 py-2.5 text-left border-b border-gray-200 text-gray-700 font-semibold">Medication</th>
                  <th className="px-3 py-2.5 text-left border-b border-gray-200 text-gray-700 font-semibold whitespace-nowrap">Dosage</th>
                  <th className="px-3 py-2.5 text-left border-b border-gray-200 text-gray-700 font-semibold">Unit</th>
                </>
              )}
              {hasWeight && showMedCols && (
                <th className="px-3 py-2.5 text-left border-b border-gray-200 text-gray-700 font-semibold whitespace-nowrap">Wt kg</th>
              )}
              {showObsCols && (
                <>
                  <th className="px-3 py-2.5 text-left border-b border-gray-200 text-gray-700 font-semibold whitespace-nowrap">Obs.type</th>
                  <th className="px-3 py-2.5 text-left border-b border-gray-200 text-gray-700 font-semibold whitespace-nowrap">Value</th>
                  <th className="px-3 py-2.5 text-left border-b border-gray-200 text-gray-700 font-semibold whitespace-nowrap">Obs.u</th>
                  <th className="px-3 py-2.5 text-left border-b border-gray-200 text-gray-700 font-semibold whitespace-nowrap">Sys</th>
                  <th className="px-3 py-2.5 text-left border-b border-gray-200 text-gray-700 font-semibold whitespace-nowrap">Dia</th>
                </>
              )}
              {(showObsCols && importCategory === "observations") && (
                <th className="px-3 py-2.5 text-left border-b border-gray-200 text-gray-700 font-semibold whitespace-nowrap">Inferred</th>
              )}
              <th className="px-3 py-2.5 text-left border-b border-gray-200 text-gray-700 font-semibold">Comments</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(r => {
              const row   = mergeRow(r)
              const ok    = rowIsImportable(row)
              const bgCls = ok ? "bg-white" : "bg-amber-50"

              const recOpts: ImportRecordType[] =
                importCategory === "medications"
                  ? ["medication"]
                  : importCategory === "observations"
                    ? ["observation", "blood_pressure_pair"]
                    : ["medication", "observation", "blood_pressure_pair"]

              return (
                <tr key={r._idx} className={`${bgCls} border-b border-gray-100 hover:brightness-95`}>
                  <td className="px-3 py-1.5">
                    <input type="checkbox"
                      checked={selected.has(r._idx)}
                      disabled={!ok}
                      onChange={e => {
                        const next = new Set(selected)
                        if (e.target.checked) next.add(r._idx)
                        else next.delete(r._idx)
                        setSelected(next)
                      }}
                      className="w-4 h-4 accent-fc-blue disabled:opacity-30" />
                  </td>
                  {showObsCols && importCategory === "both" && (
                    <td className="px-1 py-1">
                      <select
                        value={row.record_type}
                        onChange={e =>
                          updateEdit(r._idx, "record_type", e.target.value as ImportRecordType)}
                        className="border border-gray-200 rounded px-1 py-0.5 text-[0.6875rem] max-w-[118px] bg-transparent text-gray-800">
                        {recOpts.map(opt => (
                          <option key={opt} value={opt}>{opt.replace(/_/g, " ")}</option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td className="px-2 py-1.5">
                    <input type="date" value={row.date ?? ""}
                      onChange={e => updateEdit(r._idx, "date", e.target.value || null)}
                      className="border border-gray-200 rounded px-2 py-1 text-xs w-32 bg-transparent text-gray-800" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="time" value={row.time ?? ""}
                      onChange={e => updateEdit(r._idx, "time", e.target.value || null)}
                      className="border border-gray-200 rounded px-2 py-1 text-xs w-24 bg-transparent text-gray-800" />
                  </td>
                  {showMedCols && (
                    <>
                      <td className="px-2 py-1.5">
                        <input type="text" value={row.medication_name ?? ""}
                          list="medications-list"
                          onChange={e => updateEdit(r._idx, "medication_name", e.target.value || null)}
                          className="border border-gray-200 rounded px-2 py-1 text-xs w-36 bg-transparent text-gray-800" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" value={row.dosage ?? ""} min="0" step="0.1"
                          onChange={e => updateEdit(r._idx, "dosage", e.target.value ? parseFloat(e.target.value) : null)}
                          className="border border-gray-200 rounded px-2 py-1 text-xs w-14 bg-transparent text-gray-800" />
                      </td>
                      <td className="px-2 py-1.5">
                        <select value={row.dosage_unit ?? ""}
                          onChange={e => updateEdit(r._idx, "dosage_unit", e.target.value || null)}
                          className="border border-gray-200 rounded px-1 py-1 text-xs bg-transparent text-gray-800">
                          <option value="">—</option>
                          {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </td>
                    </>
                  )}
                  {hasWeight && showMedCols && (
                    <td className="px-2 py-1.5">
                      <input type="number" value={row.weight_kg ?? ""} min="0" step="0.1"
                        onChange={e =>
                          updateEdit(r._idx, "weight_kg", e.target.value ? parseFloat(e.target.value) : null)}
                        className="border border-gray-200 rounded px-2 py-1 text-xs w-14 bg-transparent text-gray-800" />
                    </td>
                  )}
                  {showObsCols && (
                    <>
                      <td className="px-2 py-1.5">
                        <input type="text" value={row.observation_type ?? ""}
                          onChange={e => updateEdit(r._idx, "observation_type", e.target.value || null)}
                          className="border border-gray-200 rounded px-2 py-1 text-xs w-28 bg-transparent text-gray-800" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" value={row.obs_value ?? ""} step="any"
                          onChange={e =>
                            updateEdit(r._idx, "obs_value", e.target.value ? parseFloat(e.target.value) : null)}
                          className="border border-gray-200 rounded px-2 py-1 text-xs w-16 bg-transparent text-gray-800" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="text" value={row.obs_unit ?? ""}
                          onChange={e => updateEdit(r._idx, "obs_unit", e.target.value || null)}
                          className="border border-gray-200 rounded px-2 py-1 text-xs w-14 bg-transparent text-gray-800" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" value={row.bp_systolic ?? ""}
                          onChange={e =>
                            updateEdit(r._idx, "bp_systolic", e.target.value ? parseFloat(e.target.value) : null)}
                          className="border border-gray-200 rounded px-2 py-1 text-xs w-12 bg-transparent text-gray-800" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" value={row.bp_diastolic ?? ""}
                          onChange={e =>
                            updateEdit(r._idx, "bp_diastolic", e.target.value ? parseFloat(e.target.value) : null)}
                          className="border border-gray-200 rounded px-2 py-1 text-xs w-12 bg-transparent text-gray-800" />
                      </td>
                    </>
                  )}
                  {showObsCols && importCategory === "observations" && (
                    <td className="px-2 py-1 text-[0.6875rem] text-gray-600 whitespace-nowrap">
                      {row.record_type.replace("_", " ")}
                    </td>
                  )}
                  <td className="px-2 py-1.5">
                    <input type="text" value={row.comments ?? ""}
                      onChange={e => updateEdit(r._idx, "comments", e.target.value || null)}
                      className="border border-gray-200 rounded px-2 py-1 text-xs w-44 bg-transparent text-gray-800" />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <datalist id="medications-list">
          {medications.map(m => <option key={m} value={m} />)}
        </datalist>
      </div>

      <div className="border-t border-gray-200 px-4 py-3 flex flex-wrap items-center gap-3 bg-white shrink-0">
        <button onClick={selectAll} className="text-sm text-fc-blue hover:underline whitespace-nowrap">Select all</button>
        <button onClick={deselectAll} className="text-sm text-gray-400 hover:underline whitespace-nowrap">Deselect all</button>
        <span className="text-sm text-gray-500">{selected.size} of {nImportable} · {visibleRows.length} rows</span>
        <div className="flex-1 min-w-[8px]" />
        <button onClick={onBack}
          className="px-4 py-2 border border-gray-300 rounded-xl text-gray-600 font-semibold text-sm hover:bg-gray-50 transition-colors whitespace-nowrap">
          ← Back
        </button>
        <button onClick={onImport} disabled={importing || selected.size === 0}
          className="bg-fc-blue text-white font-bold px-6 py-2 rounded-xl text-sm
                     disabled:opacity-50 disabled:cursor-not-allowed
                     hover:bg-fc-blue-mid active:bg-fc-blue-dark transition-colors flex items-center gap-2 whitespace-nowrap">
          {importing ? (
            <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />Importing…</>
          ) : `Import ${selected.size}`}
        </button>
      </div>
    </div>
  )
}

function ImportSuccess({ result, onReset }: { result: ImportResult; onReset: () => void }) {
  const meds = `${result.imported} medication dose record${result.imported !== 1 ? "s" : ""}`
  const obs  = result.observations_created > 0
    ? `${result.observations_created} observation row${result.observations_created !== 1 ? "s" : ""} (blood pressure counts as two)`
    : null
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8">
      <div className="text-5xl">✅</div>
      <h2 className="text-2xl font-bold text-gray-800">Import Complete</h2>
      <p className="text-lg text-gray-600 text-center">
        Imported <strong>{meds}</strong>{obs ? <> and <strong>{obs}</strong></> : ""} for <strong>{result.person_name}</strong>.
      </p>
      {result.errors.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 max-w-lg w-full">
          <p className="text-amber-800 font-semibold mb-2">
            {result.errors.length} row{result.errors.length !== 1 ? "s" : ""} had errors during import:
          </p>
          <ul className="text-amber-700 text-sm space-y-1">
            {result.errors.map((e, i) => <li key={i}>• {e}</li>)}
          </ul>
        </div>
      )}
      <button onClick={onReset}
        className="bg-fc-blue text-white font-bold px-8 py-3 rounded-xl hover:bg-fc-blue-mid active:bg-fc-blue-dark transition-colors">
        Import Another File
      </button>
    </div>
  )
}
