// SPDX-License-Identifier: AGPL-3.0-only

import { buildLines, type PdfTextItem } from "../pdf-prefill/extract"

/**
 * Identifiers worth boxing. The first group is boxed in advance; name and request number are only
 * offered (the name stays so a stored report still says whose it is; request numbers are how the
 * laboratory finds a report). Detection only ever suggests: the carer reviews every page, because a
 * missed identifier is a privacy failure.
 */
export type IdentifierCategory =
  | "medicare" | "dob" | "address" | "phone" | "email" | "ihi"
  | "name" | "request"

export const PRE_BOXED: ReadonlySet<IdentifierCategory> = new Set(["medicare", "dob", "address", "phone", "email", "ihi"])

export const CATEGORY_LABEL: Record<IdentifierCategory, string> = {
  medicare: "Medicare number",
  dob: "Date of birth",
  address: "Address",
  phone: "Phone number",
  email: "Email address",
  ihi: "Healthcare identifier",
  name: "Patient name",
  request: "Request number",
}

export interface IdentifierSuggestion {
  /** Stable within a page, for keys and for toggling. */
  id: string
  category: IdentifierCategory
  items: PdfTextItem[]
  /** Boxed unless the carer turns it off (name and request number are not). */
  preBoxed: boolean
}

/** Medicare check: 10 digits, first 2-6, weighted sum of the first eight digits mod 10 equals the ninth. */
export function isMedicareNumber(digits: string): boolean {
  if (!/^[2-6]\d{9}$/.test(digits)) return false
  const weights = [1, 3, 7, 9, 1, 3, 7, 9]
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0)
  return sum % 10 === Number(digits[8])
}

const MEDICARE_RE = /(?<!\d)([2-6]\d{3})[ -]?(\d{5})[ -]?(\d)(?:[ /-]?\d)?(?!\d)/
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
// Australian numbers: mobiles 04xx, landlines 0[2378], with optional +61 and spacing.
const PHONE_RE = /(?<!\d)(?:\+?61[ -]?|0)(?:4\d{2}|[2378])[ -]?\d{3,4}[ -]?\d{3,4}(?!\d)/
// Individual Healthcare Identifier: 16 digits starting 8003, with optional spaces.
const IHI_RE = /(?<!\d)8003[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)/
const DOB_LABEL_RE = /^\s*(?:DOB|D\.O\.B\.?|Date of Birth|Birth ?date)\b/i
const ADDRESS_LABEL_RE = /^\s*(?:Address|Addr|Residential Address|Home Address)\b/i
const NAME_LABEL_RE = /^\s*(?:Patient(?: Name)?|Name|Surname|Given Names?)\b\s*:/i
const REQUEST_LABEL_RE = /^\s*(?:Request(?: No\.?| Number)?|Accession(?: No\.?| Number)?|Lab(?:oratory)? (?:No\.?|Number)|Specimen(?: No\.?)?|UR(?: No\.?)?|MRN)\b\s*[:#]?/i
/**
 * Items further apart than this on a line belong to different columns. Wide enough for a label column
 * followed by a value column (a header of "Patient:" at one edge and the name aligned further right).
 */
const COLUMN_GAP_PT = 64
const ANOTHER_LABEL_RE = /^\s*[A-Za-z][A-Za-z .#]{1,24}:/
const STATE_POSTCODE_RE = /\b(?:SA|NSW|VIC|QLD|WA|TAS|NT|ACT)\s+\d{4}\b/

/** The items at the start of a line up to the first wide gap (its first column). */
function leadingRun(items: PdfTextItem[]): PdfTextItem[] {
  const run = [items[0]!]
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1]!
    if (items[i]!.x - (prev.x + prev.w) > COLUMN_GAP_PT) break
    run.push(items[i]!)
  }
  return run
}

/**
 * Suggested boxes for one page's text items. Labelled fields (date of birth, address, name,
 * request number) cover the label and everything to its right on that line; an address also takes
 * the next line when it ends in a state and postcode. Medicare numbers, phone numbers, email
 * addresses and healthcare identifiers are matched wherever they appear.
 */
export function suggestIdentifiers(items: readonly PdfTextItem[]): IdentifierSuggestion[] {
  const lines = buildLines([...items])
  const out: IdentifierSuggestion[] = []
  const claimed = new Set<PdfTextItem>()
  let n = 0
  const add = (category: IdentifierCategory, found: PdfTextItem[]) => {
    const fresh = found.filter(i => !claimed.has(i))
    if (fresh.length === 0) return
    fresh.forEach(i => claimed.add(i))
    out.push({ id: `${category}-${n++}`, category, items: fresh, preBoxed: PRE_BOXED.has(category) })
  }

  lines.forEach((line, idx) => {
    const text = line.items.map(i => i.s).join(" ")
    // A labelled field is its label plus what follows it on the line, stopping at a wide gap (the next
    // column) or at another label, so neighbouring fields keep their own boxes.
    const fromLabel = (re: RegExp): PdfTextItem[] => {
      const start = line.items.findIndex((_, i) => re.test(line.items.slice(0, i + 1).map(x => x.s).join(" ")))
      if (start < 0) return []
      const found = [line.items[start]!]
      for (let i = start + 1; i < line.items.length; i++) {
        const prev = line.items[i - 1]!
        const cur = line.items[i]!
        if (cur.x - (prev.x + prev.w) > COLUMN_GAP_PT || ANOTHER_LABEL_RE.test(cur.s)) break
        found.push(cur)
      }
      return found
    }

    if (DOB_LABEL_RE.test(text)) add("dob", fromLabel(DOB_LABEL_RE))
    if (ADDRESS_LABEL_RE.test(text)) {
      const found = fromLabel(ADDRESS_LABEL_RE)
      const next = lines[idx + 1]
      if (next && !STATE_POSTCODE_RE.test(text)) {
        // The address continues on the next line only along its first column, not across the page.
        const run = leadingRun(next.items)
        if (STATE_POSTCODE_RE.test(run.map(i => i.s).join(" "))) found.push(...run)
      }
      add("address", found)
    }
    if (NAME_LABEL_RE.test(text)) add("name", fromLabel(NAME_LABEL_RE))
    if (REQUEST_LABEL_RE.test(text)) add("request", fromLabel(REQUEST_LABEL_RE))

    for (const item of line.items) {
      const m = MEDICARE_RE.exec(item.s)
      if (m && isMedicareNumber(`${m[1]}${m[2]}${m[3]}`)) add("medicare", [item])
      if (IHI_RE.test(item.s)) add("ihi", [item])
      if (EMAIL_RE.test(item.s)) add("email", [item])
      if (PHONE_RE.test(item.s)) add("phone", [item])
    }
  })
  return out
}
