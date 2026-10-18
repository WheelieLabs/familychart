// SPDX-License-Identifier: AGPL-3.0-only

import type { PdfTextItem } from "../pdf-prefill/extract"
import { isPdfBlob } from "../pdf-prefill/rescan"
import { loadPdfJs, type PdfDocument } from "../pdf-prefill/read-pdf"
import type { PageBox, PageSize } from "./boxes"
import { redactPdfPages, verifyRedactedPdf, type PageToRedact, type Verification } from "./redact-pdf"

/** Pages are rasterised at this resolution: small print stays legible and a page is about 0.15 to 0.65 MB. */
const REDACT_DPI = 200
/** A photo's longer edge is capped so a camera original does not become a huge canvas. */
const IMAGE_MAX_EDGE_PX = 2400
const JPEG_QUALITY = 0.75

export interface ReportPage {
  size: PageSize
  /** The page's text layer; empty for a photo or scan, which can only be boxed by hand. */
  items: PdfTextItem[]
}

export interface ReportSource {
  kind: "pdf" | "image"
  pages: ReportPage[]
  /** The page drawn on a canvas, at a width in CSS pixels, for the review screen. */
  renderPreview(pageIndex: number, widthPx: number): Promise<HTMLCanvasElement>
  /** The page with the boxes painted into its pixels, as JPEG bytes. */
  renderJpeg(pageIndex: number, boxes: PageBox[]): Promise<Uint8Array>
  close(): void
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.ceil(width))
  canvas.height = Math.max(1, Math.ceil(height))
  return canvas
}

function paintBoxes(canvas: HTMLCanvasElement, boxes: readonly PageBox[]): void {
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#000"
  for (const b of boxes) ctx.fillRect(b.x * canvas.width, b.y * canvas.height, b.w * canvas.width, b.h * canvas.height)
}

async function toJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY))
  if (!blob) throw new Error("Could not encode the page.")
  const bytes = new Uint8Array(await blob.arrayBuffer())
  canvas.width = 0
  canvas.height = 0 // release the bitmap before the next page
  return bytes
}

async function openPdf(file: Blob): Promise<ReportSource> {
  const pdfjs = await loadPdfJs()
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
  })
  const doc: PdfDocument = await task.promise
  const pages: ReportPage[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    pages.push({
      size: { widthPt: page.view[2]!, heightPt: page.view[3]! },
      items: content.items.flatMap(it =>
        "str" in it && it.str.trim() !== ""
          ? [{ s: it.str, x: it.transform[4]!, y: it.transform[5]!, w: it.width, h: it.height }]
          : []),
    })
  }
  async function draw(pageIndex: number, scale: number): Promise<HTMLCanvasElement> {
    const page = await doc.getPage(pageIndex + 1)
    const viewport = page.getViewport({ scale })
    const canvas = canvasOf(viewport.width, viewport.height)
    await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise
    return canvas
  }
  return {
    kind: "pdf",
    pages,
    renderPreview: (i, widthPx) => draw(i, widthPx / pages[i]!.size.widthPt),
    renderJpeg: async (i, boxes) => {
      const canvas = await draw(i, REDACT_DPI / 72)
      paintBoxes(canvas, boxes)
      return toJpeg(canvas)
    },
    close: () => void task.destroy(),
  }
}

async function openImage(file: Blob): Promise<ReportSource> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  const k = Math.min(1, IMAGE_MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * k)
  const height = Math.round(bitmap.height * k)
  function draw(widthPx?: number): HTMLCanvasElement {
    const f = widthPx ? widthPx / width : 1
    const canvas = canvasOf(width * f, height * f)
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas
  }
  return {
    kind: "image",
    // Page units are image pixels: a photo has no text layer, so only the aspect ratio matters.
    pages: [{ size: { widthPt: width, heightPt: height }, items: [] }],
    renderPreview: async (_i, widthPx) => draw(widthPx),
    renderJpeg: async (_i, boxes) => {
      const canvas = draw()
      paintBoxes(canvas, boxes)
      return toJpeg(canvas)
    },
    close: () => bitmap.close(),
  }
}

/** Opens a chosen report (a PDF, or a JPEG, PNG or WebP photo or scan) for review. */
export function openReport(file: File): Promise<ReportSource> {
  return isPdfBlob(file, file.name) ? openPdf(file) : openImage(file)
}

/** Reads a finished PDF back with pdf.js and returns one string of text per page. */
async function extractPageText(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await loadPdfJs()
  const task = pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/" })
  const doc = await task.promise
  const out: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent()
    out.push(content.items.map(it => ("str" in it ? it.str : "")).join("\n"))
  }
  void task.destroy()
  return out
}

export interface RedactionResult {
  /** The file to upload: the only copy ever stored. */
  file: File
  verification: Verification
}

/**
 * Applies the boxes and builds the file to store: a PDF of redacted page images with an invisible
 * text layer (verified before it is returned), or a single re-encoded JPEG for a photo. The
 * unredacted original is never kept.
 */
export async function redactReport(
  source: ReportSource,
  boxesByPage: readonly (readonly PageBox[])[],
  originalName: string,
): Promise<RedactionResult> {
  const base = originalName.replace(/\.[^.]+$/, "") || "report"
  if (source.kind === "image") {
    const jpeg = await source.renderJpeg(0, [...(boxesByPage[0] ?? [])])
    return {
      file: new File([jpeg.slice()], `${base}-redacted.jpg`, { type: "image/jpeg" }),
      verification: { ok: true, problems: [] },
    }
  }
  const pages: PageToRedact[] = source.pages.map((p, i) => ({ size: p.size, items: p.items, boxes: [...(boxesByPage[i] ?? [])] }))
  const out = await redactPdfPages(pages, (i, boxes) => source.renderJpeg(i, boxes))
  const verification = await verifyRedactedPdf(out, pages.length, extractPageText)
  return {
    file: new File([out.bytes.slice()], `${base}-redacted.pdf`, { type: "application/pdf" }),
    verification,
  }
}
