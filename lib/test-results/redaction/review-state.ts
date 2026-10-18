// SPDX-License-Identifier: AGPL-3.0-only

import type { PageBox } from "./boxes"
import type { IdentifierSuggestion } from "./detect"

/** What the carer has decided for one page: which suggestions are boxed, and the boxes drawn by hand. */
export interface PageReview {
  suggestions: IdentifierSuggestion[]
  /** Suggestion ids currently boxed. */
  on: string[]
  manual: PageBox[]
}

export function initialPageReview(suggestions: IdentifierSuggestion[]): PageReview {
  return { suggestions, on: suggestions.filter(s => s.preBoxed).map(s => s.id), manual: [] }
}

export function toggleSuggestion(review: PageReview, id: string): PageReview {
  return review.on.includes(id)
    ? { ...review, on: review.on.filter(x => x !== id) }
    : { ...review, on: [...review.on, id] }
}

export function addManualBox(review: PageReview, box: PageBox): PageReview {
  return { ...review, manual: [...review.manual, box] }
}

export function removeManualBox(review: PageReview, index: number): PageReview {
  return { ...review, manual: review.manual.filter((_, i) => i !== index) }
}

/** Undoes the most recent hand-drawn box. */
export function undoManualBox(review: PageReview): PageReview {
  return { ...review, manual: review.manual.slice(0, -1) }
}
