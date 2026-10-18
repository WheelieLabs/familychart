// SPDX-License-Identifier: AGPL-3.0-only

import type { PdfTextItem } from "../pdf-prefill/extract"
import { boxForItems, removedItems, type PageBox, type PageSize } from "./boxes"

/** Strings shorter than this are too ordinary to chase through the rest of the report. */
const MIN_LENGTH = 5

const normalise = (s: string) => s.replace(/\s+/g, " ").trim()

/** A boxed string worth looking for elsewhere: a value, not a label ("Patient:") and not a stray word. */
function chasable(s: string): boolean {
  return s.length >= MIN_LENGTH && !s.endsWith(":") && /[A-Za-z0-9]/.test(s)
}

/**
 * Boxes for every other copy of text that is boxed somewhere. A detail boxed in a header is often
 * printed again further down or on another page; leaving that copy visible would defeat the box, so
 * an item with the same text (or one that contains a boxed value of eight characters or more) is
 * boxed too. Returns extra boxes per page, never ones that duplicate what is already boxed.
 */
export function repeatedBoxes(
  pages: readonly { size: PageSize; items: readonly PdfTextItem[]; boxes: readonly PageBox[] }[],
): PageBox[][] {
  const boxed = new Set<string>()
  const removedByPage = pages.map(p => removedItems(p.items, p.boxes, p.size))
  for (const items of removedByPage) for (const item of items) if (chasable(normalise(item.s))) boxed.add(normalise(item.s))

  return pages.map((p, i) => {
    const already = new Set(removedByPage[i])
    const extra: PageBox[] = []
    for (const item of p.items) {
      if (already.has(item)) continue
      const text = normalise(item.s)
      const repeats = [...boxed].some(b => text === b || (b.length >= 8 && text.includes(b)))
      if (repeats) extra.push(boxForItems([item], p.size))
    }
    return extra
  })
}
