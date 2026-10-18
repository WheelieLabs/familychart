// SPDX-License-Identifier: AGPL-3.0-only

import type { LimitQualifier } from "../../domain-types"

/**
 * Rule-based extraction of structured values from the text layer of a lab report PDF (no OCR, no
 * AI). Works on text items with positions (as pdf.js reports them), so it is a pure function and
 * runs on the phone. Suggestions only: the carer reviews every row against the line it came from.
 */
export interface PdfTextItem {
  s: string
  x: number
  /** Baseline, in PDF user space (origin bottom-left). */
  y: number
  w: number
  h: number
}

export interface PdfLine {
  y: number
  items: PdfTextItem[]
}

export interface PdfPageText {
  page: number
  height: number
  lines: PdfLine[]
}

export interface ExtractedRow {
  id: string
  page: number
  /** Name as printed on the report. */
  name: string
  value: number
  qualifier: LimitQualifier | null
  unit: string | null
  /** Reference range as printed, without brackets (e.g. "30 - 500"). Transcribed, never derived. */
  range: string | null
  /** The source line(s) as text, for display and tests. */
  text: string
  /** Region of the page to draw as the source strip, in PDF user space. */
  strip: { top: number; bottom: number }
}

export interface ExtractedMeta {
  /** Collection date as `YYYY-MM-DD`, when one is printed. */
  collectedYmd: string | null
  /** A conservative guess at the report title, offered only as a suggestion for Name. */
  title: string | null
}

/** Clusters text items into visual lines (same baseline within `tolerance`), each ordered left to right. */
export function buildLines(items: PdfTextItem[], tolerance = 2.5): PdfLine[] {
  const sorted = items.filter(i => i.s.trim() !== "").sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: PdfLine[] = []
  for (const item of sorted) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(last.y - item.y) < tolerance) last.items.push(item)
    else lines.push({ y: item.y, items: [item] })
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x)
  return lines
}

const VALUE = /^(<=|>=|<|>|≤|≥)?\s*(\d+(?:\.\d+)?)$/
const FLAG = /^[HLCA]$/
const RANGE = /^[[(]\s*(?:<=|>=|<|>|≤|≥)?\s*[\d.]+(?:\s*[-–]\s*[\d.]+)?\s*[\])]/
const DATE_CELL = /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/
const KNOWN_UNIT =
  /(?:mmol\/mol|mmol\/L|[µu]mol\/L|nmol\/L|pmol\/L|g\/L|g\/dL|mg\/L|mg\/dL|mg\/mmol|[µu]g\/L|ng\/L|ng\/mL|m?IU\/L|mU\/L|U\/L|units\/L|x\s?10\^?\d+\/L|fL|pg|L\/L|mm\/h|mL\/min(?:\/1\.73\s?m[²2])?)(?![A-Za-z])/i
const UNIT_TOKEN = "[A-Za-zµ%][A-Za-z0-9µ^/%.*]*(?:/[A-Za-z0-9µ^.]+)*"

/** Lines that are report furniture or prose rather than result rows. */
const NOISE_NAME = /\b(page|printed|phone|tel|fax|dob|medicare|provider|request|lab\s*no|specimen|patient|address|nata|accredit|copyright|report\s+status|abn)\b/i
/** A heading after which guideline/interpretation prose follows, until the next table header. */
const PROSE_HEADING = /^(interpretation|guidelines?|comments?|notes?|clinical\s+notes?|criteria|recommendations?|reference\s+intervals?\s+for|diagnostic)\b/i
const TABLE_HEADER = /\b(test|analyte|result|units?)\b.*\b(units?|ref(erence)?|range|result)\b|\bref(erence)?\b.*\bunits?\b/i
/** A footnote marker printed between the flag and the range ("[1]"): not a range itself. */
const FOOTNOTE = /^\[\d{1,2}\]$/

function parseValueToken(token: string): { value: number; qualifier: LimitQualifier | null } | null {
  const m = VALUE.exec(token.trim())
  if (!m) return null
  const q = m[1]
  const qualifier: LimitQualifier | null =
    q === "<" || q === "<=" || q === ">" || q === ">=" ? q : q === "≤" ? "<=" : q === "≥" ? ">=" : null
  return { value: Number(m[2]), qualifier }
}

function stripBrackets(range: string): string {
  return range.replace(/^[[(]\s*/, "").replace(/\s*[\])]$/, "").trim()
}

function cleanName(raw: string): string {
  return raw.replace(/^\*+\s*/, "").replace(/\s+/g, " ").replace(/[:,]\s*$/, "").trim()
}

/** Drops parentheticals, including one still open because the name wraps onto the next line. */
function withoutParentheticals(name: string): string {
  return name.replace(/\([^)]*(?:\)|$)/g, " ").replace(/\s+/g, " ").trim()
}

function openParens(text: string): number {
  return (text.match(/\(/g)?.length ?? 0) - (text.match(/\)/g)?.length ?? 0)
}

function plausibleName(name: string): boolean {
  if (!/[A-Za-z]/.test(name)) return false
  if (DATE_CELL.test(name)) return false
  const core = withoutParentheticals(name)
  if (core.split(/\s+/).length > 5 || core.length > 48) return false
  return !NOISE_NAME.test(name)
}

/**
 * The text of a line that is only part of an analyte name (no value, no range) because the name
 * wraps; null for any line that carries a value or range, or is too long to be a name fragment.
 */
function nameFragment(line: PdfLine): string | null {
  if (line.items.length > 3) return null
  if (line.items.some(i => parseValueToken(i.s) !== null || RANGE.test(i.s.trim()) || FOOTNOTE.test(i.s.trim()))) return null
  const text = cleanName(lineText(line))
  return text.length >= 2 && text.length <= 40 && /[A-Za-z]/.test(text) ? text : null
}

function lineText(line: PdfLine): string {
  return line.items.map(i => i.s).join(" ")
}

function stripFor(line: PdfLine): { top: number; bottom: number } {
  const h = Math.max(...line.items.map(i => i.h), 8)
  return { top: line.y + h + 4, bottom: line.y - 4 }
}

type Draft = Omit<ExtractedRow, "id" | "page">

/** Layouts 1 and 2: name, value, then flag / bracketed or parenthesised range / unit on one line. */
function parseTableLine(line: PdfLine, headerUnit: string | null, namePrefix: string | null = null): Draft | null {
  // A value and flag can be fused in one item ("6.5 H"), and a footnote marker with the range ("[1] [3-5]").
  const items = line.items.flatMap(it => {
    const m = /^(\S+)\s+([HLCA])$/.exec(it.s.trim())
    if (m && VALUE.test(m[1]!)) return [{ ...it, s: m[1]! }, { ...it, s: m[2]!, x: it.x + it.w }]
    const f = /^(\[\d{1,2}\])\s+([[(].+)$/.exec(it.s.trim())
    return f ? [{ ...it, s: f[1]! }, { ...it, s: f[2]!, x: it.x + it.w / 2 }] : [it]
  })
  const vi = items.findIndex((it, i) => i > 0 && parseValueToken(it.s) !== null)
  if (vi < 1) return null
  const name = cleanName([namePrefix, ...items.slice(0, vi).map(i => i.s)].filter(Boolean).join(" "))
  if (!plausibleName(name)) return null
  const parsed = parseValueToken(items[vi]!.s)!

  let range: string | null = null
  let unit: string | null = null
  let sawFlag = false
  const rest = items.slice(vi + 1)
  for (const [k, it] of rest.entries()) {
    const s = it.s.trim()
    if (FLAG.test(s) && !range && !sawFlag) { sawFlag = true; continue }
    // "[1]" before the real range is a footnote marker, never the range.
    if (!range && FOOTNOTE.test(s) && rest.slice(k + 1).some(x => RANGE.test(x.s.trim()) && !FOOTNOTE.test(x.s.trim()))) continue
    const m = RANGE.exec(s)
    if (m && !range) {
      const end = s.search(/[\])]/)
      range = stripBrackets(s.slice(0, end + 1))
      const tail = s.slice(end + 1).trim()
      if (tail && !unit && /[A-Za-zµ%]/.test(tail)) unit = tail
      continue
    }
    if (!unit && s.length <= 16 && /^[A-Za-zµ%x]/.test(s) && /[A-Za-zµ%]/.test(s) && !/\s{2,}/.test(s)) unit = s
  }
  if (!unit) unit = headerUnit
  if (!range && !unit) return null
  return { name, value: parsed.value, qualifier: parsed.qualifier, unit, range, text: lineText(line), strip: stripFor(line) }
}

/** Layout 3: several "name value unit (range)" analytes inline on one line, abbreviated names. */
const INLINE = new RegExp(
  `([A-Za-z][A-Za-z0-9.% /-]*?)\\s+((?:(?:<=|>=|<|>)\\s*)?\\d+(?:\\.\\d+)?)\\s+(?:[HLCA]\\s+)?(${UNIT_TOKEN})\\s+([[(][^\\])]+[\\])])`,
  "g",
)
function parseInline(line: PdfLine): Draft[] {
  const out: Draft[] = []
  const text = lineText(line)
  for (const m of text.matchAll(INLINE)) {
    const name = cleanName(m[1]!)
    const parsed = parseValueToken(m[2]!.replace(/\s+/g, ""))
    if (!parsed || !plausibleName(name)) continue
    out.push({
      name, value: parsed.value, qualifier: parsed.qualifier, unit: m[3]!, range: stripBrackets(m[4]!),
      text, strip: stripFor(line),
    })
  }
  return out
}

/**
 * Layout 4: date and request-number grids. The metric name is a column header above the value
 * (sometimes two result columns); the row begins with the collection date.
 */
function parseGridRow(lines: PdfLine[], i: number): Draft[] {
  const line = lines[i]!
  if (!(line.items.length >= 3 && DATE_CELL.test(line.items[0]!.s.trim()))) return []

  const above: PdfLine[] = []
  for (let k = i - 1; k >= 0 && above.length < 4; k--) {
    if (/^-+$/.test(lineText(lines[k]!).replace(/\s/g, ""))) continue
    above.push(lines[k]!)
    if (lines[k]!.items.some(x => /Req/i.test(x.s))) break
  }
  const rangeLine = above.find(a => a.items.some(x => /Ref\s*Range/i.test(x.s)))
  const headerItems = above.flatMap(a => a.items)
  const top = Math.max(...above.map(a => stripFor(a).top), stripFor(line).top)

  const out: Draft[] = []
  for (const it of line.items.slice(1)) {
    const s = it.s.trim()
    const parsed = parseValueToken(s)
    if (!parsed || /^\d{6,}$/.test(s)) continue // skip request numbers
    const head = headerItems
      .filter(x => Math.abs(x.x - it.x) < 45 && !/Ref\s*Range|Req|Date|Coll|Time/i.test(x.s) && !RANGE.test(x.s.trim()))
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .map(x => x.s)
      .join(" ")
    const name = cleanName(head)
    if (!name || !plausibleName(name)) continue
    const unit = line.items.find(x => x.x > it.x && /^[A-Za-zµ%]/.test(x.s.trim()) && x.s.trim().length < 14 && !FLAG.test(x.s.trim()))?.s.trim() ?? null
    const rangeItem = (rangeLine ? rangeLine.items : line.items).find(
      x => (rangeLine ? Math.abs(x.x - it.x) < 45 : true) && /^[[(]/.test(x.s.trim()),
    )
    out.push({
      name, value: parsed.value, qualifier: parsed.qualifier, unit,
      range: rangeItem ? stripBrackets(rangeItem.s.trim()) : null,
      text: `${above.slice().reverse().map(lineText).join(" / ")} / ${lineText(line)}`,
      strip: { top, bottom: line.y - 4 },
    })
  }
  return out
}

/** The unit named in a column-header line ("Test  Result (mmol/L)  Reference"), for rows that print none. */
function headerLineUnit(line: PdfLine): string | null {
  const text = lineText(line)
  if (!/(result|units?|test)/i.test(text)) return null
  if (line.items.some(i => parseValueToken(i.s))) return null
  return KNOWN_UNIT.exec(text)?.[0] ?? null
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
}

function ymd(y: string, m: string, d: string): string | null {
  const year = y.length === 2 ? `20${y}` : y
  const month = m.padStart(2, "0")
  const day = d.padStart(2, "0")
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null
  return `${year}-${month}-${day}`
}

/** Finds the printed collection date ("Collection Date 12-Aug-25", "COLLECTED: 12/08/2025"). */
export function parseCollectionDate(text: string): string | null {
  const label = /(?:collection\s*date|date\s*(?:of\s*)?collect(?:ed|ion)|collected(?:\s*on)?)\s*[:\-]?\s*/i.exec(text)
  if (!label) return null
  const rest = text.slice(label.index + label[0].length, label.index + label[0].length + 24)
  let m = /^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]*(\d{2,4})/.exec(rest)
  if (m) {
    const month = MONTHS[m[2]!.toLowerCase()]
    return month ? ymd(m[3]!, month, m[1]!) : null
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(rest)
  if (m) return ymd(m[3]!, m[2]!, m[1]!) // day first, as the owner's laboratories print it
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(rest)
  return m ? ymd(m[1]!, m[2]!, m[3]!) : null
}

const TITLE_WORDS = /\b(panel|profile|studies|function|count|screen|chemistry|haematology|hematology|biochemistry|lipids?|thyroid|iron|electrolytes|metabolic|glucose|hba1c)\b/i

function guessTitle(page: PdfPageText): string | null {
  const candidates = page.lines
    .filter(l => l.y > page.height * 0.5)
    .map(l => ({ text: lineText(l).replace(/\s+/g, " ").trim(), h: Math.max(...l.items.map(i => i.h)) }))
    .filter(l => l.text.length >= 4 && l.text.length <= 60 && TITLE_WORDS.test(l.text) && !NOISE_NAME.test(l.text) && !/\d{3,}/.test(l.text))
  if (candidates.length === 0) return null
  return candidates.sort((a, b) => b.h - a.h)[0]!.text
}

/**
 * Extracts result rows and report metadata from per-page text lines. Footers (bottom of the page),
 * patient/lab furniture and interpretation or guideline prose are ignored.
 */
export function extractFromPages(pages: PdfPageText[]): { rows: ExtractedRow[]; meta: ExtractedMeta } {
  const rows: ExtractedRow[] = []
  let collectedYmd: string | null = null

  for (const page of pages) {
    const body = page.lines.filter(l => l.y > page.height * 0.06) // drop the footer band
    let headerUnit: string | null = null
    let inProse = false
    // The first half of an analyte name that wraps onto a second line, waiting for its row.
    let pendingName: { text: string; line: PdfLine } | null = null
    const push = (drafts: Draft[]) => {
      for (const d of drafts) rows.push({ ...d, id: `p${page.page}-${rows.length}`, page: page.page })
    }

    for (let i = 0; i < body.length; i++) {
      const line = body[i]!
      const text = lineText(line)
      collectedYmd ??= parseCollectionDate(text)

      if (TABLE_HEADER.test(text)) {
        inProse = false
        headerUnit = headerLineUnit(line) ?? headerUnit
        continue
      }
      if (PROSE_HEADING.test(text.trim())) { inProse = true; continue }
      if (inProse) continue

      const unitFromHeader = headerLineUnit(line)
      if (unitFromHeader) { headerUnit = unitFromHeader; continue }

      const grid = parseGridRow(body, i)
      if (grid.length) { push(grid); continue }

      const pending = pendingName
      pendingName = null
      const fragment = nameFragment(line)
      if (fragment !== null && openParens(fragment) > 0) { pendingName = { text: fragment, line }; continue }

      let table = parseTableLine(line, headerUnit, pending?.text ?? null)
      if (table && pending) {
        table = { ...table, text: `${lineText(pending.line)} / ${table.text}`, strip: { top: stripFor(pending.line).top, bottom: table.strip.bottom } }
      }
      // The name wraps below its row: the next line closes the parenthesis and carries no value.
      const next = body[i + 1]
      const tail = table && next && openParens(table.name) > 0 ? nameFragment(next) : null
      if (table && next && tail !== null && openParens(`${table.name} ${tail}`) <= 0) {
        table = {
          ...table,
          name: cleanName(`${table.name} ${tail}`),
          text: `${table.text} / ${lineText(next)}`,
          strip: { top: table.strip.top, bottom: stripFor(next).bottom },
        }
        i++
      }
      if (table) { push([table]); continue }

      push(parseInline(line))
    }
  }

  return { rows, meta: { collectedYmd, title: pages[0] ? guessTitle(pages[0]) : null } }
}
