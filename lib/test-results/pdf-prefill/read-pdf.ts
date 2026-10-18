// SPDX-License-Identifier: AGPL-3.0-only

import { buildLines, type ExtractedRow, type PdfPageText } from "./extract"

/** pdf.js and its assets are served from the app's own origin (see scripts/copy-pdfjs-assets.mjs). */
const PDFJS_BASE = "/pdfjs"

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs")
export type PdfDocument = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>

export interface ReadPdf {
  doc: PdfDocument
  pages: PdfPageText[]
}

let pdfjsPromise: Promise<PdfJs> | null = null

/** Loads pdf.js on first use only, so the form never pays for it unless a PDF is attached. */
export function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs").then(pdfjs => {
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`
    return pdfjs
  })
  return pdfjsPromise
}

/** Reads the text layer of a PDF with positions. Resolves with no pages' worth of text for a scan. */
export async function readPdfText(file: Blob): Promise<ReadPdf> {
  const pdfjs = await loadPdfJs()
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    standardFontDataUrl: `${PDFJS_BASE}/standard_fonts/`,
    wasmUrl: `${PDFJS_BASE}/wasm/`,
  }).promise

  const pages: PdfPageText[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    const items = content.items.flatMap(item =>
      "str" in item
        ? [{ s: item.str, x: item.transform[4]!, y: item.transform[5]!, w: item.width, h: item.height }]
        : [],
    )
    pages.push({ page: n, height: page.view[3]!, lines: buildLines(items) })
  }
  return { doc, pages }
}

/** Draws the source strip for a row (the whole line, plus the column header above for grid reports). */
export async function renderSourceStrip(
  doc: PdfDocument,
  row: ExtractedRow,
  canvas: HTMLCanvasElement,
  scale: number,
): Promise<void> {
  const page = await doc.getPage(row.page)
  const viewport = page.getViewport({ scale })
  const pageHeight = page.view[3]!
  const context = canvas.getContext("2d")
  if (!context) return
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.max(Math.ceil((row.strip.top - row.strip.bottom) * scale), 1)
  await page.render({
    canvas,
    canvasContext: context,
    viewport,
    transform: [1, 0, 0, 1, 0, -(pageHeight - row.strip.top) * scale],
  }).promise
}
