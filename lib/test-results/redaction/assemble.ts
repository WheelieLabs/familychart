// SPDX-License-Identifier: AGPL-3.0-only

import type { PdfTextItem } from "../pdf-prefill/extract"
import type { PageSize } from "./boxes"

export interface RedactedPage extends PageSize {
  /** The rasterised page with the boxes already painted into the pixels. */
  jpeg: Uint8Array
  /** Text items that did not touch any box, in PDF user space (y up, baseline). */
  keptItems: PdfTextItem[]
}

/** pdfkit's browser build needs its standard font registered; the node build (vitest) has it built in. */
export async function loadPdfKit() {
  const mod = (await import("pdfkit")) as unknown as Record<string, unknown>
  const { toBytes } = await import("pdfkit/output")
  const PDFDocument = (mod.PDFDocument ?? mod.default) as new (options?: Record<string, unknown>) => PdfKitDocument
  if (typeof mod.registerStdFonts === "function") {
    ;(mod.registerStdFonts as (...fonts: unknown[]) => void)((await import("pdfkit/standard-fonts/Helvetica")).default)
  }
  return { PDFDocument, toBytes }
}

/** The slice of pdfkit's document API used here (the package ships no types). */
interface PdfKitDocument {
  font(name: string): PdfKitDocument
  fontSize(size: number): PdfKitDocument
  addPage(options: Record<string, unknown>): PdfKitDocument
  image(data: Uint8Array, x: number, y: number, options: Record<string, unknown>): PdfKitDocument
  widthOfString(text: string): number
  save(): PdfKitDocument
  restore(): PdfKitDocument
  translate(x: number, y: number): PdfKitDocument
  scale(x: number, y: number): PdfKitDocument
  addContent(content: string): PdfKitDocument
  text(text: string, x: number, y: number, options: Record<string, unknown>): PdfKitDocument
  end(): void
}

/**
 * Writes one PDF: each page is the redacted image, plus an invisible (render mode 3) text layer from
 * the kept items, positioned and stretched to the original item widths, so the stored report can
 * still be read for a rescan while carrying nothing that was boxed. Lazy-loads pdfkit.
 */
export async function assembleRedactedPdf(pages: RedactedPage[], opts: { compress?: boolean } = {}): Promise<Uint8Array> {
  const { PDFDocument, toBytes } = await loadPdfKit()
  const doc = new PDFDocument({ autoFirstPage: false, compress: opts.compress ?? true })
  const bytes = toBytes(doc)
  doc.font("Helvetica")

  for (const p of pages) {
    doc.addPage({ size: [p.widthPt, p.heightPt], margin: 0 })
    doc.image(p.jpeg, 0, 0, { width: p.widthPt, height: p.heightPt })
    for (const item of p.keptItems) {
      const size = Math.max(item.h, 1)
      doc.fontSize(size)
      const text = item.s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?")
      const natural = doc.widthOfString(text)
      if (natural <= 0 || item.w <= 0) continue
      // Baseline y (PDF, y up) to pdfkit's top-left y: the top of the text box is the baseline plus the ascent.
      const top = p.heightPt - item.y - (718 / 1000) * size
      doc.save()
      doc.translate(item.x, top)
      doc.scale(item.w / natural, 1)
      doc.addContent("3 Tr") // invisible: selectable and extractable, never painted
      doc.text(text, 0, 0, { lineBreak: false })
      doc.restore()
    }
  }
  doc.end()
  return bytes
}
