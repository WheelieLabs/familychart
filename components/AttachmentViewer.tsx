// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useEffect, useEffectEvent, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Button from "@/components/ui/Button"
import { loadPdfJs } from "@/lib/test-results/pdf-prefill/read-pdf"
import { isPdfUrl } from "@/lib/test-results/pdf-prefill/rescan"

const PDFJS_BASE = "/pdfjs"
const MAX_RENDER_SCALE = 2.5

/** Renders every page of a PDF (fetched from our own origin) into stacked, full-width canvases. */
function PdfPages({ url, onError }: { url: string; onError: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const reportError = useEffectEvent(onError)

  useEffect(() => {
    const container = host.current
    if (!container) return
    let cancelled = false
    ;(async () => {
      const res = await fetch(url)
      if (!res.ok) throw new Error("fetch failed")
      const pdfjs = await loadPdfJs()
      const doc = await pdfjs.getDocument({
        data: new Uint8Array(await res.arrayBuffer()),
        standardFontDataUrl: `${PDFJS_BASE}/standard_fonts/`,
        wasmUrl: `${PDFJS_BASE}/wasm/`,
      }).promise
      const cssWidth = container.clientWidth || window.innerWidth
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_RENDER_SCALE)
      for (let n = 1; n <= doc.numPages && !cancelled; n++) {
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio })
        const canvas = document.createElement("canvas")
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        canvas.style.width = "100%"
        canvas.style.height = "auto"
        canvas.className = "block bg-white mb-2 shadow"
        canvas.setAttribute("role", "img")
        canvas.setAttribute("aria-label", `Page ${n} of ${doc.numPages}`)
        const context = canvas.getContext("2d")
        if (!context) continue
        await page.render({ canvas, canvasContext: context, viewport }).promise
        if (cancelled) return
        container.appendChild(canvas)
        setLoading(false)
      }
      if (!cancelled) setLoading(false)
    })().catch(() => { if (!cancelled) reportError() })
    return () => {
      cancelled = true
      container.replaceChildren()
    }
  }, [url])

  return (
    <>
      {loading && <p className="text-white text-center py-8" aria-live="polite">Loading report…</p>}
      <div ref={host} />
    </>
  )
}

function AttachmentOverlay({ url, onClose }: { url: string; onClose: () => void }) {
  const [failed, setFailed] = useState(false)
  const pdf = isPdfUrl(url)

  // Escape and the device's back gesture close the viewer instead of leaving the page.
  const requestClose = useEffectEvent(onClose)
  useEffect(() => {
    history.pushState({ attachmentViewer: true }, "")
    const onPop = () => requestClose()
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") requestClose() }
    window.addEventListener("popstate", onPop)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("popstate", onPop)
      window.removeEventListener("keydown", onKey)
    }
  }, [])

  // Portalled to the body so no ancestor transform, overflow or stacking context (the History day
  // sheet slides with a transform) can confine the fixed overlay to a panel.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Report attachment"
      data-surface="dark" className="fixed inset-0 z-50 bg-black overflow-y-auto overscroll-contain">
      <div className="fixed right-3 top-3 z-10" style={{ marginTop: "env(safe-area-inset-top)" }}>
        <Button onClick={onClose} autoFocus>✕ Close</Button>
      </div>
      <div className="max-w-3xl mx-auto px-2 pt-14 pb-8">
        {failed ? (
          <p className="text-white text-center py-8">This attachment could not be displayed.</p>
        ) : pdf ? (
          <PdfPages url={url} onError={() => setFailed(true)} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin upload, not optimisable
          <img src={url} alt="Report attachment" onError={() => setFailed(true)}
            className="w-full h-auto bg-white" />
        )}
      </div>
    </div>,
    document.body,
  )
}

/**
 * "View attachment" that opens the report inside the app (pdf.js for PDFs, an image otherwise)
 * under a floating Close button, instead of a new tab. Staying in the app means the browser's own
 * viewer never takes over and the app lock is not triggered by leaving it.
 */
export default function AttachmentLink({ url, children = "View attachment" }: {
  url: string
  children?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  function close() {
    setOpen(false)
    // Drop the history entry the viewer pushed (a back gesture already did, via popstate).
    if ((history.state as { attachmentViewer?: boolean } | null)?.attachmentViewer) history.back()
  }

  return (
    <>
      <Button variant="quiet" size="compact" onClick={() => setOpen(true)}>{children}</Button>
      {open && <AttachmentOverlay url={url} onClose={close} />}
    </>
  )
}
