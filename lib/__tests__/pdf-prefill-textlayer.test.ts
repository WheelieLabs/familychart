import { describe, expect, it } from "vitest"
import { buildLines, extractFromPages, type PdfPageText } from "@/lib/test-results/pdf-prefill/extract"
import { matchMetric } from "@/lib/test-results/pdf-prefill/match"
import { TEST_METRIC_CATALOGUE } from "@/lib/test-results/test-metric-catalogue"

/** Builds a one-page text-layer PDF with each string placed at an absolute position (synthetic data only). */
function makePdf(placed: { x: number; y: number; text: string }[]): Uint8Array {
  const content = placed
    .map(p => `BT /F1 10 Tf 1 0 0 1 ${p.x} ${p.y} Tm (${p.text.replace(/[()\\]/g, "\\$&")}) Tj ET`)
    .join("\n")
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  let pdf = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new TextEncoder().encode(pdf)
}

describe("pdf.js text layer to extracted rows", () => {
  it("extracts and matches rows from a real PDF text layer", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
    const data = makePdf([
      { x: 40, y: 780, text: "Iron Studies" },
      { x: 40, y: 760, text: "Collection Date 12-Aug-25" },
      { x: 40, y: 700, text: "Ferritin" }, { x: 220, y: 700, text: "62" }, { x: 280, y: 700, text: "[30 - 500]" }, { x: 360, y: 700, text: "ug/L" },
      { x: 40, y: 680, text: "Iron" }, { x: 220, y: 680, text: "<5" }, { x: 280, y: 680, text: "[10 - 30]" }, { x: 360, y: 680, text: "umol/L" },
      { x: 40, y: 30, text: "Page 1 of 1" },
    ])
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise
    const page = await doc.getPage(1)
    const content = await page.getTextContent()
    const items = content.items.flatMap(it => ("str" in it ? [{ s: it.str, x: it.transform[4]!, y: it.transform[5]!, w: it.width, h: it.height }] : []))
    const pages: PdfPageText[] = [{ page: 1, height: page.view[3]!, lines: buildLines(items) }]

    const { rows, meta } = extractFromPages(pages)
    expect(meta.collectedYmd).toBe("2025-08-12")
    expect(rows.map(r => [r.name, r.value, r.qualifier, r.unit, r.range])).toEqual([
      ["Ferritin", 62, null, "ug/L", "30 - 500"],
      ["Iron", 5, "<", "umol/L", "10 - 30"],
    ])

    const configs = TEST_METRIC_CATALOGUE.map((m, i) => ({
      id: i, metric_name: m.name, unit: m.unit, sort_order: i, is_active: 1, aliases: m.aliases, panel: m.panel, value_type: m.valueType,
    }))
    expect(matchMetric(configs, rows[0]!.name, rows[0]!.unit)).toMatchObject({ kind: "match", config: { metric_name: "Ferritin" } })
  })
})
