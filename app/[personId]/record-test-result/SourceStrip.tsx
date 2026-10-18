// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useRef, useState } from "react"
import Modal from "@/components/Modal"
import Button from "@/components/ui/Button"
import { ImageButton } from "@/components/ui/Hotspot"
import type { ExtractedRow } from "@/lib/test-results/pdf-prefill/extract"
import { renderSourceStrip, type ReadPdf } from "@/lib/test-results/pdf-prefill/read-pdf"

interface SourceStripProps {
  pdf: ReadPdf
  row: ExtractedRow
}

function StripCanvas({ pdf, row, scale, className }: SourceStripProps & { scale: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (canvas) void renderSourceStrip(pdf.doc, row, canvas, scale).catch(() => undefined)
  }, [pdf, row, scale])
  return <canvas ref={ref} className={className} aria-label={`Line from the report: ${row.text}`} role="img" />
}

/**
 * The line of the report a suggestion came from (the whole row, with the column header above it
 * for grid-style reports). The strip is not readable at phone width, so tapping it opens a
 * full-width, sideways-scrollable view. It is never saved: the attachment is the source of truth.
 */
export default function SourceStrip({ pdf, row }: SourceStripProps) {
  const [enlarged, setEnlarged] = useState(false)

  return (
    <>
      <ImageButton label="Enlarge the line from the report" onClick={() => setEnlarged(true)}>
        <StripCanvas pdf={pdf} row={row} scale={2} className="w-full h-auto block" />
      </ImageButton>

      <Modal
        open={enlarged}
        onClose={() => setEnlarged(false)}
        title="Line from the report"
        backdropClassName="fixed inset-0 z-50 bg-black/70 flex flex-col justify-center p-3"
        panelClassName="bg-fc-panel rounded-2xl w-full p-3 flex flex-col gap-3 max-h-[90vh] overflow-y-auto"
      >
        <div className="overflow-x-auto">
          <StripCanvas pdf={pdf} row={row} scale={3.5} className="block max-w-none" />
        </div>
        <Button variant="secondary" fullWidth onClick={() => setEnlarged(false)}>Close</Button>
      </Modal>
    </>
  )
}
