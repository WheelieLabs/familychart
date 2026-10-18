// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useState } from "react"
import { extractFromPages, type ExtractedMeta, type ExtractedRow } from "@/lib/test-results/pdf-prefill/extract"
import { isPdfBlob } from "@/lib/test-results/pdf-prefill/rescan"
import { readPdfText, type ReadPdf } from "@/lib/test-results/pdf-prefill/read-pdf"

export type PrefillState =
  | { status: "idle" }
  | { status: "reading" }
  /**
   * No text layer, nothing recognised, or the file could not be read (`failed`): no banner for a new
   * report, the manual form is the baseline. A rescan uses `failed` to say the report could not be read.
   */
  | { status: "none"; failed: boolean }
  | { status: "ready"; pdf: ReadPdf; rows: ExtractedRow[]; meta: ExtractedMeta }

/**
 * Reads a PDF's text layer on the phone: a file just chosen on the form, or a stored attachment
 * fetched back as a blob for a rescan. Only PDFs are parsed (no OCR for photos or scans, no AI);
 * any failure resolves to "none" without an error.
 */
export function usePdfPrefill(source: Blob | null): PrefillState {
  const isPdf = source != null && isPdfBlob(source, source instanceof File ? source.name : null)
  const [result, setResult] = useState<{ source: Blob; state: PrefillState } | null>(null)

  useEffect(() => {
    if (!source || !isPdf) return
    let cancelled = false
    readPdfText(source)
      .then(pdf => {
        if (cancelled) return
        const { rows, meta } = extractFromPages(pdf.pages)
        setResult({ source, state: rows.length > 0 ? { status: "ready", pdf, rows, meta } : { status: "none", failed: false } })
      })
      .catch(() => { if (!cancelled) setResult({ source, state: { status: "none", failed: true } }) })
    return () => { cancelled = true }
  }, [source, isPdf])

  if (!source || !isPdf) return { status: "idle" }
  return result?.source === source ? result.state : { status: "reading" }
}
