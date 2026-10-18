// SPDX-License-Identifier: AGPL-3.0-only

import type { PdfTextItem } from "../pdf-prefill/extract"
import { assembleRedactedPdf } from "./assemble"
import { keptItems, removedItems, type PageBox, type PageSize } from "./boxes"
import { decodedPdfText, leakedStrings } from "./verify"

export interface PageToRedact {
  size: PageSize
  /** The page's text layer (empty for a scanned page). */
  items: PdfTextItem[]
  boxes: PageBox[]
}

export interface RedactedPdf {
  bytes: Uint8Array
  /** The text of every item a box removed, for the verification step. */
  removedText: string[]
  /** The text meant to survive on each page, so a string left visible elsewhere is not mistaken for a leak. */
  keptTextByPage: string[]
}

/**
 * Builds the stored report from the original pages. `renderJpeg` rasterises one page with its boxes
 * painted into the pixels before encoding (in the browser: pdf.js onto a canvas), so what was boxed no
 * longer exists anywhere in the file; one page at a time keeps phone memory flat.
 */
export async function redactPdfPages(
  pages: readonly PageToRedact[],
  renderJpeg: (pageIndex: number, boxes: PageBox[]) => Promise<Uint8Array>,
): Promise<RedactedPdf> {
  const redactedPages = []
  const removedText: string[] = []
  const keptTextByPage: string[] = []
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!
    const kept = keptItems(p.items, p.boxes, p.size)
    redactedPages.push({ ...p.size, jpeg: await renderJpeg(i, p.boxes), keptItems: kept })
    keptTextByPage.push(kept.map(item => item.s).join("\n"))
    removedText.push(...removedItems(p.items, p.boxes, p.size).map(item => item.s))
  }
  return { bytes: await assembleRedactedPdf(redactedPages), removedText, keptTextByPage }
}

export interface Verification {
  ok: boolean
  /** Why it failed, in words for the carer; empty when ok. */
  problems: string[]
}

/**
 * Checks the finished file before it is used: same page count, and on every page nothing boxed is
 * findable in the re-extracted text layer or the file's text runs beyond what that page was meant to
 * keep. `extractPageText` reads the output back (pdf.js in the browser) and returns one string per
 * page. A failure names the pages, never the text.
 */
export async function verifyRedactedPdf(
  output: RedactedPdf,
  expectedPages: number,
  extractPageText: (bytes: Uint8Array) => Promise<string[]>,
): Promise<Verification> {
  const problems: string[] = []
  const pageText = await extractPageText(output.bytes)
  if (pageText.length !== expectedPages) problems.push("The redacted report has a different number of pages.")
  const leakyPages = pageText
    .map((text, i) => ({ page: i + 1, leaked: leakedStrings(output.removedText, text, output.keptTextByPage[i] ?? "") }))
    .filter(p => p.leaked.length > 0)
    .map(p => p.page)
  // The file's own text runs are checked as well, in case the re-read missed something.
  const inRuns = leakedStrings(output.removedText, decodedPdfText(output.bytes), output.keptTextByPage.join("\n"))
  if (leakyPages.length > 0 || inRuns.length > 0) {
    problems.push(`Boxed text is still in the file${leakyPages.length > 0 ? ` (page ${leakyPages.join(", ")})` : ""}.`)
  }
  return { ok: problems.length === 0, problems }
}
