// SPDX-License-Identifier: AGPL-3.0-only

import type { PdfTextItem } from "../pdf-prefill/extract"

/**
 * A redaction box on a page, in fractions of the page (0 to 1) from its top-left corner. One
 * coordinate system serves PDFs, scans and photos, and survives any render scale.
 */
export interface PageBox {
  x: number
  y: number
  w: number
  h: number
}

/** PDF text items are in points with the origin bottom-left; a page is `widthPt` by `heightPt`. */
export interface PageSize {
  widthPt: number
  heightPt: number
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** The box that covers one or more text items, with a little room for descenders and padding. */
export function boxForItems(items: readonly PdfTextItem[], page: PageSize, padPt = 3): PageBox {
  const left = Math.min(...items.map(i => i.x)) - padPt
  const right = Math.max(...items.map(i => i.x + i.w)) + padPt
  const bottom = Math.min(...items.map(i => i.y - i.h * 0.25)) - padPt
  const top = Math.max(...items.map(i => i.y + i.h)) + padPt
  const x = clamp01(left / page.widthPt)
  const y = clamp01(1 - top / page.heightPt)
  return {
    x,
    y,
    w: clamp01(right / page.widthPt) - x,
    h: clamp01(1 - bottom / page.heightPt) - y,
  }
}

/**
 * True when a text item touches a page box. The item's own extent is its glyphs, a little tighter than the
 * padded box drawn over it, so a box that only grazes the margin of the line above or below leaves that
 * line's text layer alone (the picture and the text layer then agree).
 */
export function itemTouchesBox(item: PdfTextItem, box: PageBox, page: PageSize): boolean {
  const iLeft = item.x / page.widthPt
  const iRight = (item.x + item.w) / page.widthPt
  const iTop = 1 - (item.y + item.h * 0.85) / page.heightPt
  const iBottom = 1 - (item.y - item.h * 0.1) / page.heightPt
  return iLeft < box.x + box.w && iRight > box.x && iTop < box.y + box.h && iBottom > box.y
}

/** The text items that survive redaction: anything touching a box is dropped whole, never trimmed. */
export function keptItems(items: readonly PdfTextItem[], boxes: readonly PageBox[], page: PageSize): PdfTextItem[] {
  return items.filter(item => !boxes.some(box => itemTouchesBox(item, box, page)))
}

/** The items a box removes, so verification knows exactly which strings must not survive. */
export function removedItems(items: readonly PdfTextItem[], boxes: readonly PageBox[], page: PageSize): PdfTextItem[] {
  return items.filter(item => boxes.some(box => itemTouchesBox(item, box, page)))
}

/** A drawn box from two corners (any drag direction), clipped to the page; null when it is too small to be deliberate. */
export function boxFromCorners(a: { x: number; y: number }, b: { x: number; y: number }, minSize = 0.01): PageBox | null {
  const x = clamp01(Math.min(a.x, b.x))
  const y = clamp01(Math.min(a.y, b.y))
  const w = clamp01(Math.max(a.x, b.x)) - x
  const h = clamp01(Math.max(a.y, b.y)) - y
  return w < minSize || h < minSize ? null : { x, y, w, h }
}
