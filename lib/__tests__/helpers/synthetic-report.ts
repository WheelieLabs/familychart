import { loadPdfKit } from "@/lib/test-results/redaction/assemble"

// PROTOTYPE (throwaway): builds a synthetic multi-page lab report (fictional data only) for the spike.

/** A fictional, checksum-valid Medicare number. */
export const SYNTHETIC_MEDICARE = "2123 45670 1"
export const SYNTHETIC_NAME = "TESTPERSON, Alex"
export const SYNTHETIC_DOB = "DOB: 04/07/1961"

export interface SyntheticPage {
  /** Strings placed at absolute PDF positions. */
  placed: { x: number; y: number; text: string }[]
}

/** Pages of analyte rows under a patient block; rows are the shape the extractor already understands. */
export function syntheticReport(pageCount: number): SyntheticPage[] {
  const pages: SyntheticPage[] = []
  const analytes = [
    ["Ferritin", "62", "[30 - 500]", "ug/L"],
    ["Iron", "14", "[10 - 30]", "umol/L"],
    ["Haemoglobin", "135", "[115 - 165]", "g/L"],
    ["Sodium", "139", "[135 - 145]", "mmol/L"],
    ["Potassium", "4.1", "[3.5 - 5.2]", "mmol/L"],
    ["Creatinine", "70", "[45 - 90]", "umol/L"],
  ]
  for (let p = 0; p < pageCount; p++) {
    const placed = [{ x: 40, y: 800, text: "Synthetic Pathology Services" }]
    // Later pages repeat the patient banner, as laboratory reports do.
    if (p > 0) placed.push({ x: 40, y: 825, text: SYNTHETIC_DOB }, { x: 300, y: 825, text: `Medicare: ${SYNTHETIC_MEDICARE}` })
    if (p === 0) {
      placed.push(
        { x: 40, y: 780, text: `Patient: ${SYNTHETIC_NAME}` },
        { x: 40, y: 765, text: SYNTHETIC_DOB },
        { x: 300, y: 765, text: `Medicare: ${SYNTHETIC_MEDICARE}` },
        { x: 40, y: 750, text: "Address: 1 Example Street, Testville" },
        { x: 40, y: 735, text: "Collection Date 12-Aug-25" },
      )
    }
    let y = p === 0 ? 700 : 760
    for (let r = 0; r < 28; r++) {
      const [name, value, range, unit] = analytes[r % analytes.length]!
      placed.push(
        { x: 40, y, text: r < analytes.length ? name! : `${name} ${p}-${r}` },
        { x: 220, y, text: value! },
        { x: 280, y, text: range! },
        { x: 360, y, text: unit! },
      )
      y -= 22
    }
    placed.push({ x: 40, y: 30, text: `Page ${p + 1} of ${pageCount}` })
    pages.push({ placed })
  }
  return pages
}

/** Writes the synthetic report as a text-layer PDF with pdfkit (the same writer used for the redacted output). */
export async function makeSyntheticPdf(pageCount: number): Promise<Uint8Array> {
  const { PDFDocument, toBytes } = await loadPdfKit()
  const doc = new PDFDocument({ autoFirstPage: false })
  const bytes = toBytes(doc)
  doc.font("Helvetica").fontSize(10)
  for (const page of syntheticReport(pageCount)) {
    doc.addPage({ size: [595, 842], margin: 0 })
    for (const t of page.placed) doc.text(t.text, t.x, 842 - t.y - 7.18, { lineBreak: false })
  }
  doc.end()
  return bytes
}
