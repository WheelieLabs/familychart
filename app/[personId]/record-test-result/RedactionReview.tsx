// SPDX-License-Identifier: AGPL-3.0-only

"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { useFocusTrap } from "@/components/Modal"
import Banner from "@/components/ui/Banner"
import Button from "@/components/ui/Button"
import Chip from "@/components/ui/Chip"
import Hotspot from "@/components/ui/Hotspot"
import { disabledWhen } from "@/lib/ui/disabled-props"
import { openReport, redactReport, type ReportSource } from "@/lib/test-results/redaction/browser"
import { boxForItems, boxFromCorners, type PageBox } from "@/lib/test-results/redaction/boxes"
import { CATEGORY_LABEL, suggestIdentifiers } from "@/lib/test-results/redaction/detect"
import { repeatedBoxes } from "@/lib/test-results/redaction/repeats"
import {
  addManualBox, initialPageReview, removeManualBox, toggleSuggestion, undoManualBox, type PageReview,
} from "@/lib/test-results/redaction/review-state"

interface Props {
  file: File
  /** The redacted copy to store. The unredacted original is never uploaded. */
  onDone: (redacted: File, boxCount: number) => void
  onCancel: () => void
}

const PREVIEW_WIDTH_PX = 900

/** The boxes that will be painted on a page: suggestions that are on, plus the ones drawn by hand. */
function activeBoxes(review: PageReview, size: { widthPt: number; heightPt: number }): PageBox[] {
  return [
    ...review.suggestions.filter(s => review.on.includes(s.id)).map(s => boxForItems(s.items, size)),
    ...review.manual,
  ]
}

const pct = (n: number) => `${n * 100}%`

/**
 * Mandatory check of a report for personal details before it is stored. Suggested boxes (Medicare
 * number, date of birth, address, phone, email, healthcare identifier) start on; the patient name and
 * request number are offered but start off. Anything can be toggled, and boxes can be drawn by hand
 * (the only way for a photo or scan). Applying paints the boxes into the pixels, so nothing boxed remains.
 */
export default function RedactionReview({ file, onDone, onCancel }: Props) {
  const [source, setSource] = useState<ReportSource | null>(null)
  const [reviews, setReviews] = useState<PageReview[]>([])
  const [pageIdx, setPageIdx] = useState(0)
  const [loadError, setLoadError] = useState("")
  const [drawing, setDrawing] = useState(false)
  const [draft, setDraft] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null)
  const [working, setWorking] = useState("")
  const [problem, setProblem] = useState("")
  const canvasHost = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, true, { onEscape: working === "" ? onCancel : undefined })

  useEffect(() => {
    let cancelled = false
    let opened: ReportSource | null = null
    openReport(file)
      .then(s => {
        if (cancelled) { s.close(); return }
        opened = s
        setSource(s)
        setReviews(s.pages.map(p => initialPageReview(suggestIdentifiers(p.items))))
      })
      .catch(() => { if (!cancelled) setLoadError("This report could not be opened for checking, so it cannot be attached.") })
    return () => { cancelled = true; opened?.close() }
  }, [file])

  // Draw the current page, without any boxes, under the overlay.
  useEffect(() => {
    if (!source) return
    let cancelled = false
    source.renderPreview(pageIdx, PREVIEW_WIDTH_PX)
      .then(canvas => {
        if (cancelled || !canvasHost.current) return
        canvas.style.width = "100%"
        canvas.style.height = "auto"
        canvas.style.display = "block"
        canvasHost.current.replaceChildren(canvas)
      })
      .catch(() => { if (!cancelled) setLoadError("This page could not be shown.") })
    return () => { cancelled = true }
  }, [source, pageIdx])

  const page = source?.pages[pageIdx]
  const review = reviews[pageIdx]
  const total = source?.pages.length ?? 0
  // What will be boxed: the suggestions that are on and the boxes drawn by hand, plus every other copy of
  // boxed text anywhere in the report (a detail boxed in a header is often printed again further down).
  const plan = useMemo(() => {
    if (!source) return null
    const chosen = source.pages.map((p, i) => ({ size: p.size, items: p.items, boxes: activeBoxes(reviews[i]!, p.size) }))
    const extra = repeatedBoxes(chosen)
    return { chosen: chosen.map(p => p.boxes), extra }
  }, [reviews, source])
  const boxCount = plan ? plan.chosen.reduce((n, b, i) => n + b.length + plan.extra[i]!.length, 0) : 0
  const repeatCount = plan ? plan.extra.reduce((n, b) => n + b.length, 0) : 0

  const update = useCallback((fn: (r: PageReview) => PageReview) => {
    setReviews(prev => prev.map((r, i) => (i === pageIdx ? fn(r) : r)))
  }, [pageIdx])

  function point(e: ReactPointerEvent): { x: number; y: number } {
    const rect = overlay.current!.getBoundingClientRect()
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }
  }

  async function apply() {
    if (!source) return
    setProblem("")
    try {
      setWorking("Removing the boxed details…")
      const boxes = plan!.chosen.map((b, i) => [...b, ...plan!.extra[i]!])
      const result = await redactReport(source, boxes, file.name)
      if (!result.verification.ok) {
        setProblem(`${result.verification.problems.join(" ")} Nothing has been attached. Check the boxes and try again.`)
        setWorking("")
        return
      }
      onDone(result.file, boxCount)
    } catch {
      setProblem("Could not prepare the report. Nothing has been attached.")
      setWorking("")
    }
  }

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Check the report for personal details"
      className="fc-surface-app fc-redaction"
      style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="fc-redaction__bar">
        <h2 className="fc-section-title fc-redaction__title">Check for personal details</h2>
        <Button variant="secondary" onClick={onCancel} {...disabledWhen(working !== "" && "Wait for the report to be prepared.")}>
          Cancel
        </Button>
      </div>

      <div className="fc-redaction__body">
        <p className="fc-redaction__copy">
          Boxed areas are blacked out and removed from the report before it is saved; the original is not kept.
          Check every page, and draw a box over anything else that identifies the patient.
        </p>

        {loadError && <Banner kind="error">{loadError}</Banner>}
        {!source && !loadError && <p className="fc-redaction__copy">Opening the report…</p>}

        {source && page && review && (
          <>
            <div className="fc-redaction__pager">
              <Button variant="secondary"
                onClick={() => { setPageIdx(i => i - 1); setDrawing(false) }}
                {...disabledWhen(pageIdx === 0 && "This is the first page.")}>‹ Previous</Button>
              <span aria-live="polite">Page {pageIdx + 1} of {total}</span>
              <Button variant="secondary"
                onClick={() => { setPageIdx(i => i + 1); setDrawing(false) }}
                {...disabledWhen(pageIdx >= total - 1 && "This is the last page.")}>Next ›</Button>
            </div>

            <div className="fc-redaction__page" style={{ aspectRatio: `${page.size.widthPt} / ${page.size.heightPt}` }}>
              <div ref={canvasHost} className="fc-redaction__canvas" />
              <div
                ref={overlay}
                className="fc-redaction__canvas"
                style={{ touchAction: drawing ? "none" : "auto", cursor: drawing ? "crosshair" : "default" }}
                onPointerDown={e => {
                  if (!drawing) return
                  e.currentTarget.setPointerCapture(e.pointerId)
                  const p = point(e)
                  setDraft({ a: p, b: p })
                }}
                onPointerMove={e => { if (drawing && draft) setDraft({ a: draft.a, b: point(e) }) }}
                onPointerUp={() => {
                  if (draft) {
                    const box = boxFromCorners(draft.a, draft.b)
                    if (box) update(r => addManualBox(r, box))
                  }
                  setDraft(null)
                }}
                onPointerCancel={() => setDraft(null)}
              >
                {review.suggestions.map(s => {
                  const box = boxForItems(s.items, page.size)
                  const on = review.on.includes(s.id)
                  return (
                    <Hotspot key={s.id} pressed={on}
                      label={`${CATEGORY_LABEL[s.category]}: ${on ? "boxed" : "not boxed"}`}
                      onClick={() => { if (!drawing) update(r => toggleSuggestion(r, s.id)) }}
                      look={on ? "solid" : "outline"} box={box} inert={drawing} />
                  )
                })}
                {review.manual.map((box, i) => (
                  // eslint-disable-next-line react-x/no-array-index-key -- a drawn box has no id; its position in the list is its identity
                  <Hotspot key={i} label="Drawn box: tap to remove"
                    onClick={() => { if (!drawing) update(r => removeManualBox(r, i)) }}
                    look="solid" box={box} inert={drawing} />
                ))}
                {plan?.extra[pageIdx]?.map(box => (
                  <div key={`${box.x}-${box.y}`} aria-hidden className="absolute bg-black pointer-events-none"
                    style={{ left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h) }} />
                ))}
                {draft && (() => {
                  const b = boxFromCorners(draft.a, draft.b, 0)
                  return b ? <div className="absolute border-2 border-red-600 bg-black/50" style={{ left: pct(b.x), top: pct(b.y), width: pct(b.w), height: pct(b.h) }} /> : null
                })()}
              </div>
            </div>

            <div className="fc-form-actions">
              <Chip kind="toggle" pressed={drawing} onPressedChange={setDrawing}>
                {drawing ? "Drawing: drag on the page" : "Draw a box"}
              </Chip>
              <Button variant="secondary" onClick={() => update(undoManualBox)}
                {...disabledWhen(review.manual.length === 0 && "No drawn boxes to undo.")}>
                Undo last box
              </Button>
            </div>

            {review.suggestions.length > 0 && (
              <div role="group" aria-label="Suggested details on this page" className="fc-chip-set__chips">
                {review.suggestions.map(s => (
                  <Chip key={s.id} kind="toggle" pressed={review.on.includes(s.id)}
                    onPressedChange={() => update(r => toggleSuggestion(r, s.id))}>
                    {CATEGORY_LABEL[s.category]}
                  </Chip>
                ))}
              </div>
            )}
            {repeatCount > 0 && (
              <p className="fc-redaction__copy" role="status">
                {repeatCount} more cop{repeatCount === 1 ? "y" : "ies"} of boxed details elsewhere in the report {repeatCount === 1 ? "is" : "are"} boxed too.
              </p>
            )}
            {review.suggestions.length === 0 && source.kind === "pdf" && (
              <p className="fc-redaction__copy">No personal details were recognised on this page. Look it over and draw a box over anything that identifies the patient.</p>
            )}
            {source.kind === "image" && (
              <p className="fc-redaction__copy">This is a photo or scan, so nothing can be detected: draw a box over each personal detail.</p>
            )}
          </>
        )}

        {problem && <Banner kind="error">{problem}</Banner>}
      </div>

      <div className="fc-redaction__foot" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        {!source || working !== "" ? (
          <Button fullWidth disabled disabledReason={working || "Wait for the report to open."}>
            {working || "Use this report"}
          </Button>
        ) : (
          <Button fullWidth onClick={() => void apply()}>
            {boxCount === 0 ? "Nothing to remove: use this report" : `Remove ${boxCount} box${boxCount === 1 ? "" : "es"} and use this report`}
          </Button>
        )}
      </div>
    </div>
  )
}
